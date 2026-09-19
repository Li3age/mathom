//! Squarified treemap layout (Bruls / Huizing / van Wijk, 2000).
//!
//! Rects are emitted parents-before-children: forward iteration is painter's
//! order for drawing, reverse is deepest-first for hit-testing.
//!
//! `TreemapOptions::min_side_px` is a floor, not a cut-off line. A child too
//! small to earn its proportional share is raised to one minimum block and
//! drawn anyway, so a directory tiles edge to edge instead of opening holes
//! nobody can attribute to anything. What still does not fit at that size is
//! dropped — smallest first — and the survivors re-normalize into the space,
//! so dropping leaves no hole either. A directory subdivides only while its
//! own interior can hold a legible child.

use crate::category::categorize;
use crate::entry::EntryFlags;
use crate::tree::{NodeId, Tree};

#[derive(Clone, Copy, Debug)]
pub struct Viewport {
    pub w: f32,
    pub h: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct TreemapOptions {
    /// Legibility floor, in pixels: a child is sized to be at least this wide
    /// *and* this tall. A child whose proportional share falls short is raised
    /// to one minimum block rather than culled, so the parent has no hole in
    /// it; an area test alone would let a 40×0.1 sliver through and read as
    /// blank. Children that no longer fit even at this size are dropped,
    /// smallest first, and the rest spread into their space. Zero lays the
    /// children out strictly proportionally.
    pub min_side_px: f32,
    pub padding_px: f32,
    /// Vertical strip a directory reserves at the top of its interior for its
    /// label; zero reserves nothing. Only the *children's* frame shrinks —
    /// see `emit` for why a directory's own rect must not depend on this.
    pub label_px: f32,
    pub max_depth: u8,
    /// Omit SYSTEM entries and proportion tiles by visible bytes.
    pub hide_system: bool,
}

impl Default for TreemapOptions {
    fn default() -> Self {
        TreemapOptions {
            min_side_px: 1.0,
            padding_px: 1.0,
            label_px: 0.0,
            max_depth: 32,
            hide_system: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TreemapRect {
    pub id: NodeId,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub depth: u8,
    pub is_dir: bool,
    pub category: u8,
}

/// Lays out any directory subtree into `viewport`.
pub fn layout(
    tree: &Tree,
    root: NodeId,
    viewport: Viewport,
    opts: &TreemapOptions,
) -> Vec<TreemapRect> {
    layout_impl(tree, root, viewport, opts, None)
}

/// Layout under a view filter: per-node effective bytes (0 = omit), as
/// built by `search::build_overlay`. hide_system is already baked into the
/// overlay, so `opts.hide_system` is not consulted here.
pub fn layout_with_filter(
    tree: &Tree,
    root: NodeId,
    viewport: Viewport,
    opts: &TreemapOptions,
    bytes: &[u64],
) -> Vec<TreemapRect> {
    layout_impl(tree, root, viewport, opts, Some(bytes))
}

fn layout_impl(
    tree: &Tree,
    root: NodeId,
    viewport: Viewport,
    opts: &TreemapOptions,
    filter: Option<&[u64]>,
) -> Vec<TreemapRect> {
    let mut out = Vec::new();
    if tree.is_empty() || (root as usize) >= tree.len() || viewport.w <= 0.0 || viewport.h <= 0.0 {
        return out;
    }
    let frame = Frame {
        x: 0.0,
        y: 0.0,
        w: viewport.w as f64,
        h: viewport.h as f64,
    };
    let owned: Vec<u64>;
    let visible: Option<&[u64]> = match filter {
        Some(bytes) => Some(bytes),
        None if opts.hide_system => {
            let mut v = vec![0u64; tree.len()];
            fill_visible(tree, root, &mut v);
            owned = v;
            Some(&owned)
        }
        None => None,
    };
    emit(tree, root, frame, 0, opts, visible, &mut out);
    out
}

/// Fills `visible` with subtree sizes that omit SYSTEM entries, for the
/// subtree under `root` only. SYSTEM subtrees are never visited, so `visible`
/// must arrive zeroed. Explicit stack: tree depth is unbounded.
fn fill_visible(tree: &Tree, root: NodeId, visible: &mut [u64]) {
    // (id, exiting): a dir is pushed twice — once to expand, once to fold its
    // finished total into its parent. Mirrors `search::build_overlay`.
    let mut stack = vec![(root, false)];
    while let Some((id, exiting)) = stack.pop() {
        let node = tree.node(id);
        if !exiting {
            if node.flags.contains(EntryFlags::SYSTEM) {
                continue;
            }
            if node.is_dir() {
                stack.push((id, true));
                stack.extend(tree.children(id).map(|c| (c, false)));
                continue;
            }
            visible[id as usize] = node.size;
        }
        // The traversal root's parent lies outside the laid-out subtree.
        if id != root
            && let Some(parent) = node.parent()
        {
            visible[parent as usize] =
                visible[parent as usize].saturating_add(visible[id as usize]);
        }
    }
}

fn effective_size(tree: &Tree, id: NodeId, visible: Option<&[u64]>) -> u64 {
    match visible {
        // Bounds-tolerant: a tree that grew past a filter's snapshot reads
        // as size 0 here rather than panicking.
        Some(v) => v.get(id as usize).copied().unwrap_or(0),
        None => tree.node(id).size,
    }
}

#[derive(Clone, Copy)]
struct Frame {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Frame {
    fn area(&self) -> f64 {
        self.w * self.h
    }

    fn inset(&self, pad: f64) -> Frame {
        Frame {
            x: self.x + pad,
            y: self.y + pad,
            w: self.w - 2.0 * pad,
            h: self.h - 2.0 * pad,
        }
    }

    /// Takes `pad` off the top edge alone: the strip a label sits in.
    fn below(&self, pad: f64) -> Frame {
        Frame {
            y: self.y + pad,
            h: self.h - pad,
            ..*self
        }
    }
}

fn emit(
    tree: &Tree,
    id: NodeId,
    frame: Frame,
    depth: u8,
    opts: &TreemapOptions,
    visible: Option<&[u64]>,
    out: &mut Vec<TreemapRect>,
) {
    let node = tree.node(id);
    out.push(TreemapRect {
        id,
        x: frame.x as f32,
        y: frame.y as f32,
        w: frame.w as f32,
        h: frame.h as f32,
        depth,
        is_dir: node.is_dir(),
        category: categorize(tree.name(id), node.is_dir()) as u8,
    });
    if !node.is_dir() || depth >= opts.max_depth {
        return;
    }
    // Everything below changes only the *children's* frame. The rect pushed
    // above must stay a function of this directory's own frame and nothing
    // else, or a cap that stops recursion early would move the rects that
    // survive it — the UI switches depth live and relies on them holding
    // still. The floor, the dropping and the re-normalizing in `lay_children`
    // are functions of this directory alone for the same reason: never of
    // `max_depth`, and never of anything global.
    let inner = frame.inset(opts.padding_px as f64);
    if inner.w <= 0.0 || inner.h <= 0.0 {
        return;
    }
    let body = inner.below(opts.label_px as f64);
    // Adaptive depth: subdivide only where a child could still be legible.
    // Going one level deeper costs padding, a label strip and the padding
    // again, so a branch runs out of room on its own and stops — which is
    // what keeps a big folder from dissolving into specks, and a small one
    // from showing levels nobody can see. `max_depth` is only an upper bound
    // on top of that.
    if body.w < opts.min_side_px as f64 || body.h < opts.min_side_px as f64 {
        return;
    }
    lay_children(tree, id, body, depth + 1, opts, visible, out);
}

fn lay_children(
    tree: &Tree,
    dir: NodeId,
    frame: Frame,
    depth: u8,
    opts: &TreemapOptions,
    visible: Option<&[u64]>,
    out: &mut Vec<TreemapRect>,
) {
    let mut items: Vec<(NodeId, u64)> = tree
        .children(dir)
        .map(|c| (c, effective_size(tree, c, visible)))
        .filter(|&(_, size)| size > 0)
        .collect();
    if items.is_empty() {
        return;
    }
    items.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    let total: f64 = items.iter().map(|&(_, s)| s as f64).sum();
    let area = frame.area();
    let scale = area / total;
    let min_side = opts.min_side_px as f64;

    let rows = if min_side <= 0.0 {
        // No floor to honour: strictly proportional, nothing to refit.
        let weights: Vec<f64> = items.iter().map(|&(_, s)| s as f64 * scale).collect();
        squarify(&weights, frame)
    } else {
        // The floor is a floor, not a cut-off line. A child too small to earn
        // its proportional share is raised to one minimum block and drawn
        // anyway, so the directory fills edge to edge. What does not fit at
        // that size is dropped — smallest first — and the survivors spread
        // into the space that frees, so dropping leaves no hole either. That
        // is the whole trade: draw the small stuff when there is room for it,
        // and when there is not, the user is here for the big blocks anyway.
        //
        // `scale` stays the proportions-only scale throughout. Raising the
        // weights and then scaling *those* up overshoots the frame, and the
        // clamp that triggers is exactly the gap this exists to remove.
        let weights: Vec<f64> = items
            .iter()
            .map(|&(_, s)| (s as f64 * scale).max(min_side * min_side))
            .collect();
        fit(&weights, frame, min_side)
    };

    for row in &rows {
        for (k, f) in row.frames.iter().enumerate() {
            emit(tree, items[row.start + k].0, *f, depth, opts, visible, out);
        }
    }
}

/// One squarified row: consecutive items starting at `start`, laid out as a
/// slab. Every frame in a row shares the row's short side.
struct Row {
    start: usize,
    frames: Vec<Frame>,
}

impl Row {
    fn end(&self) -> usize {
        self.start + self.frames.len()
    }
}

/// Packs a floored weight list into `frame`: shed from the tail until the
/// survivors tile it in legible blocks. Every pass re-normalizes, so whatever
/// the dropped items were holding flows back into the ones that remain.
fn fit(weights: &[f64], frame: Frame, min_side: f64) -> Vec<Row> {
    let area = frame.area();
    let mut keep = weights.len();
    loop {
        let mut sum: f64 = weights[..keep].iter().sum();
        while keep > 1 && sum > area * (1.0 + 1e-9) {
            keep -= 1;
            sum -= weights[keep];
        }
        let norm = area / sum;
        let fitted: Vec<f64> = weights[..keep].iter().map(|w| w * norm).collect();
        let rows = squarify(&fitted, frame);
        match first_unfit(&rows, keep, min_side) {
            // The very first row is unfit, so no later one can be better: the
            // run is cut too finely for this frame to tile legibly at all.
            // Shed a slice of the tail and try a coarser cut — dropping
            // everything but the biggest child would be the wrong answer for a
            // directory full of equals.
            Some(0) if keep > 1 => keep -= (keep / 16).max(1),
            // A later row gives out: that row and the tail behind it are what
            // the floor cannot afford.
            Some(at) if keep > 1 => keep = at,
            // `keep == 1` lays one block across the whole frame, which cannot
            // be unfit — so this is the clean case, and the only way out.
            _ => return rows,
        }
    }
}

/// The first item index the run could not place legibly: a frame with a side
/// under the floor, or an item the frame ran out before reaching. `None` when
/// the whole run is clean.
fn first_unfit(rows: &[Row], keep: usize, min_side: f64) -> Option<usize> {
    for row in rows {
        // A row's frames all carry its short side, so this covers that too.
        if row.frames.iter().any(|f| f.w.min(f.h) < min_side) {
            return Some(row.start);
        }
    }
    let covered = rows.last().map_or(0, Row::end);
    (covered < keep).then_some(covered)
}

fn worst_aspect(sum: f64, max: f64, min: f64, side: f64) -> f64 {
    let s2 = sum * sum;
    let w2 = side * side;
    (w2 * max / s2).max(s2 / (w2 * min))
}

/// Greedy squarification: packs `weights` into rows of near-square items,
/// largest first. Pure geometry — `frame` is left alone and nothing is
/// emitted, so a caller can look the result over and lay the items out again.
fn squarify(weights: &[f64], frame: Frame) -> Vec<Row> {
    let mut rows = Vec::new();
    let mut remaining = frame;
    let mut i = 0;
    while i < weights.len() {
        if remaining.w <= 0.0 || remaining.h <= 0.0 {
            break;
        }
        let side = remaining.w.min(remaining.h);

        let (mut sum, mut max, mut min) = (weights[i], weights[i], weights[i]);
        let mut worst = worst_aspect(sum, max, min, side);
        let mut j = i + 1;
        while j < weights.len() {
            let a = weights[j];
            let candidate = worst_aspect(sum + a, max.max(a), min.min(a), side);
            if candidate > worst {
                break;
            }
            worst = candidate;
            sum += a;
            max = max.max(a);
            min = min.min(a);
            j += 1;
        }

        let horizontal = remaining.w < remaining.h; // the row spans the short side
        let thickness = (sum / side).min(if horizontal { remaining.h } else { remaining.w });

        let mut frames = Vec::with_capacity(j - i);
        let mut offset = 0.0;
        for (k, &a) in weights[i..j].iter().enumerate() {
            // The last item takes what is left rather than its own share, so
            // rounding cannot strand a hairline of frame at the far edge.
            let len = if k + 1 == j - i {
                (side - offset).max(0.0)
            } else {
                a / thickness
            };
            frames.push(if horizontal {
                Frame {
                    x: remaining.x + offset,
                    y: remaining.y,
                    w: len,
                    h: thickness,
                }
            } else {
                Frame {
                    x: remaining.x,
                    y: remaining.y + offset,
                    w: thickness,
                    h: len,
                }
            });
            offset += len;
        }
        rows.push(Row { start: i, frames });

        if horizontal {
            remaining.y += thickness;
            remaining.h -= thickness;
        } else {
            remaining.x += thickness;
            remaining.w -= thickness;
        }
        i = j;
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::{EntryBatch, EntryFlags, FileEntry};
    use crate::tree::TreeBuilder;

    const DIR: EntryFlags = EntryFlags::DIR;
    const FILE: EntryFlags = EntryFlags(0);

    fn entry(id: u32, parent: u32, flags: EntryFlags, size: u64) -> FileEntry {
        FileEntry {
            path_id: id,
            parent_id: parent,
            name_off: 0,
            name_len: 0,
            flags,
            size,
            allocated_size: size,
            mtime: 0,
        }
    }

    fn flat_tree(files: &[(&str, u64)]) -> Tree {
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        for (i, &(name, size)) in files.iter().enumerate() {
            b.push(name, entry(i as u32 + 1, 0, FILE, size));
        }
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        builder.finish()
    }

    /// Nothing culled, nothing reserved: the pure squarified geometry the
    /// exact-area assertions below are written against.
    fn no_padding() -> TreemapOptions {
        TreemapOptions {
            min_side_px: 0.0,
            padding_px: 0.0,
            label_px: 0.0,
            max_depth: 32,
            hide_system: false,
        }
    }

    fn rect_of(rects: &[TreemapRect], id: NodeId) -> TreemapRect {
        *rects.iter().find(|r| r.id == id).expect("rect missing")
    }

    fn area(r: &TreemapRect) -> f64 {
        r.w as f64 * r.h as f64
    }

    /// A flat directory of `n` files, all the same size.
    fn equal_files(n: u32, size: u64) -> Tree {
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        for i in 0..n {
            b.push("f", entry(i + 1, 0, FILE, size));
        }
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        builder.finish()
    }

    /// A flat directory of one `big` file and `n` one-byte specks.
    fn speck_tree(big: u64, n: u32) -> Tree {
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("big", entry(1, 0, FILE, big));
        for i in 0..n {
            b.push("speck", entry(2 + i, 0, FILE, 1));
        }
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        builder.finish()
    }

    /// A three-level sample holding both dominant files and speck swarms, so
    /// the floor has work to do at every level.
    fn mixed_tree() -> Tree {
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("media", entry(1, 0, DIR, 0));
        b.push("movie", entry(2, 1, FILE, 400_000));
        b.push("clips", entry(3, 1, DIR, 0));
        b.push("readme", entry(4, 0, FILE, 500));
        b.push("src", entry(5, 0, DIR, 0));
        let mut next = 6u32;
        for _ in 0..10 {
            b.push("clip", entry(next, 3, FILE, 1_000));
            next += 1;
        }
        for _ in 0..200 {
            b.push("dud", entry(next, 3, FILE, 1));
            next += 1;
        }
        for _ in 0..40 {
            b.push("mod", entry(next, 5, FILE, 300));
            next += 1;
        }
        for _ in 0..600 {
            b.push("crumb", entry(next, 5, FILE, 1));
            next += 1;
        }
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        builder.finish()
    }

    /// The area a directory hands to its children: its own rect less the
    /// padding and the label strip, exactly as `emit` computes it.
    fn body_area(dir: &TreemapRect, opts: &TreemapOptions) -> f64 {
        let pad = opts.padding_px as f64;
        let w = (dir.w as f64 - 2.0 * pad).max(0.0);
        let h = (dir.h as f64 - 2.0 * pad - opts.label_px as f64).max(0.0);
        w * h
    }

    /// Total area `dir`'s direct children were laid into. Containment is what
    /// identifies them — it has to be, since two directories at the same depth
    /// are both `depth + 1` away from the same root.
    fn children_area(rects: &[TreemapRect], dir: &TreemapRect, opts: &TreemapOptions) -> f64 {
        let pad = opts.padding_px;
        let (x0, y0) = (dir.x + pad, dir.y + pad + opts.label_px);
        let (x1, y1) = (dir.x + dir.w - pad, dir.y + dir.h - pad);
        rects
            .iter()
            .filter(|r| {
                r.depth == dir.depth + 1
                    && r.x >= x0 - 0.01
                    && r.y >= y0 - 0.01
                    && r.x + r.w <= x1 + 0.01
                    && r.y + r.h <= y1 + 0.01
            })
            .map(area)
            .sum()
    }

    #[test]
    fn areas_are_proportional_to_sizes() {
        let tree = flat_tree(&[("a", 500), ("b", 300), ("c", 200)]);
        let rects = layout(&tree, 0, Viewport { w: 100.0, h: 100.0 }, &no_padding());

        assert!((area(&rect_of(&rects, 1)) - 5000.0).abs() < 1.0);
        assert!((area(&rect_of(&rects, 2)) - 3000.0).abs() < 1.0);
        assert!((area(&rect_of(&rects, 3)) - 2000.0).abs() < 1.0);
    }

    #[test]
    fn children_tile_the_parent_without_overlap() {
        let tree = flat_tree(&[
            ("a", 600),
            ("b", 600),
            ("c", 400),
            ("d", 300),
            ("e", 200),
            ("f", 200),
            ("g", 100),
        ]);
        let rects = layout(&tree, 0, Viewport { w: 600.0, h: 400.0 }, &no_padding());
        let leaves: Vec<_> = rects.iter().filter(|r| !r.is_dir).collect();

        let total: f64 = leaves.iter().map(|r| area(r)).sum();
        assert!((total - 240_000.0).abs() < 1.0, "leaves cover the viewport");

        for r in &leaves {
            assert!(r.x >= -0.01 && r.y >= -0.01);
            assert!(r.x as f64 + r.w as f64 <= 600.01);
            assert!(r.y as f64 + r.h as f64 <= 400.01);
        }
        for (i, a) in leaves.iter().enumerate() {
            for b in leaves.iter().skip(i + 1) {
                let x_overlap = (a.x + a.w).min(b.x + b.w) as f64 - a.x.max(b.x) as f64;
                let y_overlap = (a.y + a.h).min(b.y + b.h) as f64 - a.y.max(b.y) as f64;
                assert!(
                    x_overlap <= 0.01 || y_overlap <= 0.01,
                    "rects {} and {} overlap",
                    a.id,
                    b.id
                );
            }
        }
    }

    /// The canonical example from the squarified-treemap paper: sizes
    /// 6,6,4,3,2,2,1 in a 6×4 rectangle. Squarification keeps rects
    /// near-square (slice-and-dice would reach ratios up to 16); the paper's
    /// own layout of this example ends with the 1-unit item at 0.6×1.67 —
    /// aspect 25/9 ≈ 2.78 — so that is the exact expected worst case here.
    #[test]
    fn canonical_example_stays_near_square() {
        let tree = flat_tree(&[
            ("a", 6),
            ("b", 6),
            ("c", 4),
            ("d", 3),
            ("e", 2),
            ("f", 2),
            ("g", 1),
        ]);
        let rects = layout(&tree, 0, Viewport { w: 600.0, h: 400.0 }, &no_padding());

        let mut worst = 0.0f32;
        for r in rects.iter().filter(|r| !r.is_dir) {
            let aspect = (r.w / r.h).max(r.h / r.w);
            worst = worst.max(aspect);
        }
        assert!(
            (worst - 25.0 / 9.0).abs() < 0.01,
            "worst aspect {worst} differs from the paper's 25/9"
        );
    }

    #[test]
    fn parents_are_emitted_before_children_and_contain_them() {
        // root / dir(1, contains f1 900 + f2 100) + file(4, 1000)
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("dir", entry(1, 0, DIR, 0));
        b.push("f1", entry(2, 1, FILE, 900));
        b.push("f2", entry(3, 1, FILE, 100));
        b.push("big", entry(4, 0, FILE, 1000));
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        let tree = builder.finish();

        let rects = layout(&tree, 0, Viewport { w: 200.0, h: 100.0 }, &no_padding());

        let pos = |id: NodeId| rects.iter().position(|r| r.id == id).expect("missing");
        assert!(pos(0) < pos(1));
        assert!(pos(1) < pos(2));
        assert!(pos(1) < pos(3));

        let dir = rect_of(&rects, 1);
        for id in [2u32, 3] {
            let c = rect_of(&rects, id);
            assert!(c.x >= dir.x - 0.01 && c.y >= dir.y - 0.01);
            assert!(c.x + c.w <= dir.x + dir.w + 0.01);
            assert!(c.y + c.h <= dir.y + dir.h + 0.01);
            assert_eq!(c.depth, dir.depth + 1);
        }
        // dir and big split the root 50/50
        assert!((area(&dir) - 10_000.0).abs() < 1.0);
    }

    #[test]
    fn padding_insets_children_inside_their_directory() {
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("dir", entry(1, 0, DIR, 0));
        b.push("f", entry(2, 1, FILE, 100));
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        let tree = builder.finish();

        let opts = TreemapOptions {
            min_side_px: 0.0,
            padding_px: 2.0,
            label_px: 0.0,
            max_depth: 32,
            hide_system: false,
        };
        let rects = layout(&tree, 0, Viewport { w: 100.0, h: 100.0 }, &opts);

        let dir = rect_of(&rects, 1);
        let f = rect_of(&rects, 2);
        assert!((f.x - (dir.x + 2.0)).abs() < 0.01);
        assert!((f.y - (dir.y + 2.0)).abs() < 0.01);
        assert!((f.w - (dir.w - 4.0)).abs() < 0.01);
        assert!((f.h - (dir.h - 4.0)).abs() < 0.01);
    }

    /// 1,000,000 vs 1 in 100×100: the small file's share is a 100×0.0001
    /// sliver, and it cannot buy a 1×1 block either — so it goes. Note where
    /// its space ends up: with the others, not left blank where it was.
    #[test]
    fn a_child_below_the_floor_loses_its_share_to_the_rest() {
        let tree = speck_tree(1_000_000, 1);
        let opts = TreemapOptions {
            min_side_px: 1.0,
            ..no_padding()
        };
        let rects = layout(&tree, 0, Viewport { w: 100.0, h: 100.0 }, &opts);

        assert!(rects.iter().all(|r| r.id != 2), "tiny rect must be dropped");
        // Not its proportional share — which would leave the sliver's width
        // blank — but the whole block.
        assert!((area(&rect_of(&rects, 1)) - 10_000.0).abs() < 0.01);
    }

    /// The floor is a side, not an area: 10,000 vs 1 in 100×100 gives the
    /// small file a 100×0.01 slice worth a whole square pixel, which an area
    /// test passes and nobody can see.
    #[test]
    fn a_sliver_cannot_hold_the_floor_and_is_dropped() {
        let tree = speck_tree(10_000, 1);
        let opts = TreemapOptions {
            min_side_px: 2.0,
            ..no_padding()
        };
        let rects = layout(&tree, 0, Viewport { w: 100.0, h: 100.0 }, &opts);

        assert!(rects.iter().all(|r| r.id != 2), "sliver must be dropped");
        assert!((area(&rect_of(&rects, 1)) - 10_000.0).abs() < 0.01);
    }

    /// Positively: children whose proportional share is under the floor are
    /// drawn at the floor anyway, and what they cover is the whole block. A
    /// culling layout would have left this 100×100 empty.
    #[test]
    fn small_children_are_raised_to_the_floor_and_fill_the_block() {
        // 300 equal files: 33px² each, under the 6px (36px²) floor.
        let tree = equal_files(300, 1);
        let opts = TreemapOptions {
            min_side_px: 6.0,
            ..no_padding()
        };
        let rects = layout(&tree, 0, Viewport { w: 100.0, h: 100.0 }, &opts);

        let root = rect_of(&rects, 0);
        let drawn = rects.iter().filter(|r| r.depth == 1).count();
        // A 100×100 frame holds at most (100/6)² ≈ 277 of these. The run has
        // to stay in that neighbourhood: shedding the tail until one block is
        // left would also fill the frame, and would be useless.
        assert!(drawn >= 100, "the block is tiled, not one plate: {drawn}");
        assert!(
            (children_area(&rects, &root, &opts) - body_area(&root, &opts)).abs() < 0.01,
            "the children cover the block"
        );
        for r in rects.iter().filter(|r| r.depth == 1) {
            assert!(
                r.w.min(r.h) >= 6.0,
                "id {} came out {}×{}, under the floor",
                r.id,
                r.w,
                r.h
            );
        }
    }

    /// "All one size": siblings equally far under the floor come out equally
    /// sized, whatever their byte counts.
    #[test]
    fn floored_siblings_all_get_the_same_size() {
        let tree = equal_files(300, 1);
        let opts = TreemapOptions {
            min_side_px: 6.0,
            ..no_padding()
        };
        let rects = layout(&tree, 0, Viewport { w: 100.0, h: 100.0 }, &opts);

        let areas: Vec<f64> = rects.iter().filter(|r| r.depth == 1).map(area).collect();
        assert!(areas.len() > 1);
        let small = areas.iter().copied().fold(f64::MAX, f64::min);
        let large = areas.iter().copied().fold(f64::MIN, f64::max);
        assert!(small / large > 0.99, "sizes spread {small} to {large}");
    }

    /// The same rule on a padded, labelled frame: the child that cannot buy a
    /// block is gone, and the one that is left covers the body exactly — the
    /// padding and the strip are all that shows through.
    #[test]
    fn a_dropped_tail_leaves_no_gap() {
        let tree = speck_tree(1_000_000, 1);
        let opts = TreemapOptions {
            min_side_px: 6.0,
            padding_px: 2.0,
            label_px: 5.0,
            ..no_padding()
        };
        let rects = layout(&tree, 0, Viewport { w: 100.0, h: 100.0 }, &opts);

        let root = rect_of(&rects, 0);
        assert!(rects.iter().all(|r| r.id != 2), "tiny cannot buy a block");
        assert!(
            (children_area(&rects, &root, &opts) - body_area(&root, &opts)).abs() < 0.01,
            "the survivor takes the dropped child's share too"
        );
    }

    /// One file holding 99.985% of a 600×400 block leaves the rest able to buy
    /// exactly one minimum block between them. Laying them out anyway squeezes
    /// the remainder into a 0.09px column — and hit-testing walks deepest
    /// first, so that column would answer for the whole 400px of its height.
    #[test]
    fn a_degenerate_tail_is_dropped_instead_of_drawn_as_a_sliver() {
        let tree = speck_tree(999_850, 150);
        let opts = TreemapOptions {
            min_side_px: 6.0,
            ..no_padding()
        };
        let rects = layout(&tree, 0, Viewport { w: 600.0, h: 400.0 }, &opts);

        for r in &rects {
            assert!(
                r.w.min(r.h) >= 6.0,
                "id {} is {}×{}, under the floor",
                r.id,
                r.w,
                r.h
            );
        }
        let root = rect_of(&rects, 0);
        assert!(
            (children_area(&rects, &root, &opts) - body_area(&root, &opts)).abs() < 0.01,
            "dropping the tail does not open a hole"
        );
    }

    /// The whole rule as one invariant, under the shipped options: at every
    /// depth, every directory's children exactly cover the frame it hands
    /// down. A gap anywhere is the bug this exists to prevent.
    #[test]
    fn production_options_leave_no_gaps_at_any_depth() {
        let opts = TreemapOptions {
            min_side_px: 6.0,
            padding_px: 1.0,
            label_px: 15.0,
            max_depth: 32,
            hide_system: false,
        };
        let tree = mixed_tree();
        let rects = layout(&tree, 0, Viewport { w: 900.0, h: 600.0 }, &opts);

        let dirs: Vec<TreemapRect> = rects.iter().copied().filter(|r| r.is_dir).collect();
        assert!(dirs.len() >= 4, "the sample really does nest");
        assert!(
            rects.iter().any(|r| r.depth == 3),
            "and runs deep enough for the floor to bite"
        );
        for dir in &dirs {
            let kids = children_area(&rects, dir, &opts);
            // No children means the directory stayed a plate: its body could
            // not hold a legible block, so it never subdivided.
            if kids == 0.0 {
                continue;
            }
            let body = body_area(dir, &opts);
            assert!(
                (kids - body).abs() < 0.001 * body,
                "dir {} covers {kids} of its {body}px² body",
                dir.id
            );
        }
    }

    /// Each level takes its strip out of its own children's frame, so a nested
    /// directory starts one strip lower than its parent did. That compounding
    /// is what makes depth cost pixels — and why it stops on its own.
    #[test]
    fn every_level_takes_its_label_strip_from_its_children() {
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("d1", entry(1, 0, DIR, 0));
        b.push("d2", entry(2, 1, DIR, 0));
        b.push("f", entry(3, 2, FILE, 100));
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        let tree = builder.finish();

        let rects = layout(&tree, 0, Viewport { w: 100.0, h: 100.0 }, &labelled(10.0));

        // The root's own rect is the whole viewport: the strip is taken below
        // it, not out of it.
        assert!((rect_of(&rects, 0).y).abs() < 0.01);
        assert!((rect_of(&rects, 0).h - 100.0).abs() < 0.01);
        for (id, top, height) in [(1u32, 10.0, 90.0), (2, 20.0, 80.0), (3, 30.0, 70.0)] {
            let r = rect_of(&rects, id);
            assert!((r.y - top).abs() < 0.01, "id {id} starts a strip lower");
            assert!(
                (r.h - height).abs() < 0.01,
                "id {id} lost a strip off its height"
            );
            assert!((r.w - 100.0).abs() < 0.01, "a strip is vertical");
        }
    }

    /// Depth changes stay live because a capped layout is a prefix of a deeper
    /// one. The strip is the one addition that could break it — it has to
    /// shrink frames the cap then hides anyway, never the rect a shallower
    /// layout keeps.
    #[test]
    fn a_label_strip_does_not_move_the_rects_a_cap_leaves_behind() {
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("d1", entry(1, 0, DIR, 0));
        b.push("big", entry(2, 0, FILE, 400));
        b.push("d2", entry(3, 1, DIR, 0));
        b.push("f", entry(4, 1, FILE, 200));
        b.push("g", entry(5, 3, FILE, 100));
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        let tree = builder.finish();
        let vp = Viewport { w: 400.0, h: 300.0 };

        let capped = layout(&tree, 0, vp, &capped_at(2, 10.0));
        let deep: Vec<TreemapRect> = layout(&tree, 0, vp, &capped_at(8, 10.0))
            .into_iter()
            .filter(|r| r.depth <= 2)
            .collect();

        assert_eq!(capped, deep);
        assert!(capped.iter().any(|r| r.id == 3), "depth-2 dir is emitted");
        assert!(capped.iter().all(|r| r.id != 5), "depth-3 file is not");
    }

    /// Depth follows the pixels available: the same subtree expands when it has
    /// room and stops when it does not, with `max_depth` nowhere near either.
    #[test]
    fn a_directory_stops_expanding_when_its_interior_is_too_small() {
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("wide", entry(1, 0, FILE, 800));
        b.push("mid", entry(2, 0, DIR, 0));
        b.push("deep", entry(3, 2, FILE, 200));
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        let tree = builder.finish();

        let opts = TreemapOptions {
            min_side_px: 25.0,
            ..labelled(10.0)
        };

        // A 40px-tall viewport leaves `mid` 30px, and its own strip takes 10:
        // the 20px left cannot hold a child, so it stays a plain plate.
        let cramped = layout(&tree, 0, Viewport { w: 200.0, h: 40.0 }, &opts);
        assert!(cramped.iter().any(|r| r.id == 2), "the dir itself is drawn");
        assert!(
            cramped.iter().all(|r| r.id != 3),
            "its interior cannot hold a legible child"
        );

        // The same tree given more height expands, and nobody raised a cap.
        let roomy = layout(&tree, 0, Viewport { w: 200.0, h: 100.0 }, &opts);
        assert!(roomy.iter().any(|r| r.id == 3), "now there is room");
        assert!(opts.max_depth > 1, "the cap never came into it");
    }

    fn labelled(label_px: f32) -> TreemapOptions {
        TreemapOptions {
            label_px,
            ..no_padding()
        }
    }

    fn capped_at(max_depth: u8, label_px: f32) -> TreemapOptions {
        TreemapOptions {
            max_depth,
            label_px,
            ..no_padding()
        }
    }

    #[test]
    fn zero_size_children_emit_nothing_and_nothing_is_nan() {
        let tree = flat_tree(&[("empty", 0), ("real", 10)]);
        let rects = layout(&tree, 0, Viewport { w: 100.0, h: 100.0 }, &no_padding());

        assert!(rects.iter().all(|r| r.id != 1), "zero-size file skipped");
        for r in &rects {
            assert!(r.x.is_finite() && r.y.is_finite());
            assert!(r.w.is_finite() && r.h.is_finite());
        }
        assert!((area(&rect_of(&rects, 2)) - 10_000.0).abs() < 1.0);
    }

    #[test]
    fn max_depth_stops_recursion() {
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("dir", entry(1, 0, DIR, 0));
        b.push("f", entry(2, 1, FILE, 100));
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        let tree = builder.finish();

        let opts = TreemapOptions {
            min_side_px: 0.0,
            padding_px: 0.0,
            label_px: 0.0,
            max_depth: 1,
            hide_system: false,
        };
        let rects = layout(&tree, 0, Viewport { w: 100.0, h: 100.0 }, &opts);

        assert!(rects.iter().any(|r| r.id == 1), "depth-1 dir emitted");
        assert!(rects.iter().all(|r| r.id != 2), "depth-2 file not emitted");
    }

    #[test]
    fn drill_down_layouts_from_a_subdirectory() {
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("dir", entry(1, 0, DIR, 0));
        b.push("f1", entry(2, 1, FILE, 300));
        b.push("f2", entry(3, 1, FILE, 100));
        b.push("elsewhere", entry(4, 0, FILE, 9999));
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        let tree = builder.finish();

        let rects = layout(&tree, 1, Viewport { w: 100.0, h: 100.0 }, &no_padding());

        assert_eq!(rects[0].id, 1, "drill root comes first at depth 0");
        assert_eq!(rects[0].depth, 0);
        assert!(rects.iter().all(|r| r.id != 4), "siblings of root excluded");
        // f1:f2 = 3:1 of the full viewport
        assert!((area(&rect_of(&rects, 2)) - 7500.0).abs() < 1.0);
        assert!((area(&rect_of(&rects, 3)) - 2500.0).abs() < 1.0);
    }

    fn hide_system_opts() -> TreemapOptions {
        TreemapOptions {
            hide_system: true,
            ..no_padding()
        }
    }

    /// A filter's byte array drives both areas and omissions.
    #[test]
    fn external_filter_bytes_drive_areas_and_omissions() {
        let tree = flat_tree(&[("a", 500), ("b", 300), ("c", 200)]);
        let bytes = vec![600u64, 500, 0, 100]; // root, a, b(filtered out), c
        let rects = layout_with_filter(
            &tree,
            0,
            Viewport { w: 100.0, h: 100.0 },
            &no_padding(),
            &bytes,
        );
        assert!(rects.iter().all(|r| r.id != 2), "zero-byte node omitted");
        assert!((area(&rect_of(&rects, 1)) - 10_000.0 * 5.0 / 6.0).abs() < 1.0);
        assert!((area(&rect_of(&rects, 3)) - 10_000.0 / 6.0).abs() < 1.0);
    }

    #[test]
    fn hide_system_omits_system_files_and_reproportions() {
        // root / a (non-system, 500) + sys (system, 500)
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("a", entry(1, 0, FILE, 500));
        b.push("sys", entry(2, 0, EntryFlags::SYSTEM, 500));
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        let tree = builder.finish();

        let vp = Viewport { w: 100.0, h: 100.0 };
        assert!(
            layout(&tree, 0, vp, &no_padding())
                .iter()
                .any(|r| r.id == 2)
        );

        let hidden = layout(&tree, 0, vp, &hide_system_opts());
        assert!(hidden.iter().all(|r| r.id != 2), "system file hidden");
        // "a" now fills the whole viewport instead of half.
        assert!((area(&rect_of(&hidden, 1)) - 10_000.0).abs() < 1.0);
    }

    #[test]
    fn visible_sizes_stay_zero_under_a_system_directory() {
        // root / sysdir(SYSTEM) { deep { g 9999 } } + keep 100
        let sys_dir = DIR.union(EntryFlags::SYSTEM);
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("sysdir", entry(1, 0, sys_dir, 0));
        b.push("deep", entry(2, 1, DIR, 0));
        b.push("g", entry(3, 2, FILE, 9999));
        b.push("keep", entry(4, 0, FILE, 100));
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        let tree = builder.finish();

        let mut visible = vec![0u64; tree.len()];
        fill_visible(&tree, 0, &mut visible);

        assert_eq!(visible[0], 100, "root counts only the non-system file");
        assert_eq!(visible[1], 0);
        assert_eq!(visible[2], 0, "descendants of a system dir stay zero");
        assert_eq!(visible[3], 0);
        assert_eq!(visible[4], 100);
    }

    #[test]
    fn visible_sizes_never_write_outside_the_traversal_subtree() {
        // root { a { f 70 } + b 900 }, filled from `a`
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("a", entry(1, 0, DIR, 0));
        b.push("f", entry(2, 1, FILE, 70));
        b.push("b", entry(3, 0, FILE, 900));
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        let tree = builder.finish();

        let mut visible = vec![0u64; tree.len()];
        fill_visible(&tree, 1, &mut visible);

        assert_eq!(visible[1], 70, "the traversal root gets its nested total");
        assert_eq!(visible[2], 70);
        assert_eq!(visible[0], 0, "the parent outside the subtree is untouched");
        assert_eq!(visible[3], 0);
    }

    #[test]
    fn a_file_as_traversal_root_keeps_its_own_size() {
        let tree = flat_tree(&[("a.txt", 42)]);

        let mut visible = vec![0u64; tree.len()];
        fill_visible(&tree, 1, &mut visible);

        assert_eq!(visible[1], 42);
        assert_eq!(visible[0], 0);
    }

    #[test]
    fn hide_system_hides_whole_system_subtree() {
        // root / dir { f 500 } + sysdir(SYSTEM) { g 9999 }
        let sys_dir = DIR.union(EntryFlags::SYSTEM);
        let mut b = EntryBatch::default();
        b.push("root", entry(0, 0, DIR, 0));
        b.push("dir", entry(1, 0, DIR, 0));
        b.push("f", entry(2, 1, FILE, 500));
        b.push("sysdir", entry(3, 0, sys_dir, 0));
        b.push("g", entry(4, 3, FILE, 9999));
        let mut builder = TreeBuilder::new();
        builder.add_batch(&b);
        let tree = builder.finish();

        let hidden = layout(
            &tree,
            0,
            Viewport { w: 100.0, h: 100.0 },
            &hide_system_opts(),
        );
        // The huge system subtree is gone entirely, not just visually blank.
        assert!(hidden.iter().all(|r| r.id != 3 && r.id != 4));
        assert!((area(&rect_of(&hidden, 1)) - 10_000.0).abs() < 1.0);
        assert!((area(&rect_of(&hidden, 2)) - 10_000.0).abs() < 1.0);
    }
}
