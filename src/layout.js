(function (global) {
  "use strict";

  const RingMapChart = global.RingMapChart;
  const { config, model } = RingMapChart;

  function createLayoutEngine() {
    const measureCanvas = document.createElement("canvas");
    const measureContext = measureCanvas.getContext("2d");

    function measureLabel(label) {
      measureContext.font = measureFont();
      return measureContext.measureText(label).width;
    }

    function measureFont() {
      const rootStyle = getComputedStyle(document.documentElement);
      const size = rootStyle.getPropertyValue("--node-font-size").trim() || "13px";
      const family = getComputedStyle(document.body).fontFamily || "Inter, ui-sans-serif, system-ui, sans-serif";
      return `800 ${size} ${family}`;
    }

    function nodeFontSize() {
      const rootStyle = getComputedStyle(document.documentElement);
      const value = parseFloat(rootStyle.getPropertyValue("--node-font-size"));
      return Number.isFinite(value) ? value : 13;
    }

    function nodeSize(node) {
      const base = config.layout;
      const fontSize = nodeFontSize();
      const scale = fontSize / 13;
      const minWidth = node.depth === 0 ? base.rootWidth : base.nodeWidth;
      const minHeight = node.depth === 0 ? base.rootHeight : base.nodeHeight;
      return {
        width: Math.max(minWidth * scale, Math.ceil(measureLabel(node.label) + base.nodePadX * scale * 2)),
        height: Math.max(minHeight, Math.ceil(minHeight * scale))
      };
    }

    function maxNodeWidth(tree) {
      return model.visibleNodes(tree).reduce((max, { node }) => Math.max(max, nodeSize(node).width), config.layout.rootWidth);
    }

    function leafCounts(tree) {
      const counts = new Map();
      function count(node) {
        const total = node.children.length ? node.children.reduce((sum, child) => sum + count(child), 0) : 1;
        counts.set(node.id, total);
        return total;
      }
      count(tree);
      return counts;
    }

    function subtreeMaxDepth(node) {
      if (!node.children.length) return node.depth;
      return Math.max(...node.children.map(subtreeMaxDepth));
    }

    function treeBranchSpan(primary, spacing) {
      return (subtreeMaxDepth(primary) - 1) * spacing.treeLevelGap + config.layout.nodeHeight + spacing.treeLevelGap;
    }

    function treeLayerHeight(tree, spacing) {
      if (!tree.children.length) return config.layout.rootHeight;
      const branchHeight = tree.children.reduce((sum, primary) => sum + treeBranchSpan(primary, spacing), 0);
      return config.layout.rootHeight + spacing.treeLevelGap + branchHeight - spacing.treeLevelGap;
    }

    function treeLeafGap(tree, spacing) {
      return Math.max(spacing.treeLeafGap, maxNodeWidth(tree) + 28);
    }

    function maxPrimaryLeafCount(tree, counts) {
      if (!tree.children.length) return 1;
      return tree.children.reduce((max, primary) => Math.max(max, counts.get(primary.id) || 1), 1);
    }

    function worldSize(tree, viewport, viewMode, spacing) {
      const nodeWidth = maxNodeWidth(tree);
      const radius = viewMode === "ring" ? outerRingRadius(tree, spacing) : flatRingRadius(tree, spacing);
      const ringDiameter = radius * 2 + nodeWidth + 48;
      return {
        width: Math.max(viewport.width + 240, ringDiameter),
        height: Math.max(viewport.height + 180, ringDiameter)
      };
    }

    function layout(tree, viewport, viewMode, spacing) {
      const world = worldSize(tree, viewport, viewMode, spacing);
      const nodes = model.visibleNodes(tree);
      if (viewMode === "ring") {
        const ring = ringLayout(tree, nodes, world, spacing);
        staggerCrowdedRingNodes(nodes, ring.positions, ring.center);
        resolveNodeOverlaps(nodes, ring.positions);
        return { world, positions: ring.positions, nodes, rings: ring.rings, bounds: layoutBounds(nodes, ring.positions) };
      }
      const flat = flatRingLayout(tree, nodes, world, spacing);
      staggerCrowdedRingNodes(nodes, flat.positions, flat.center);
      resolveNodeOverlaps(nodes, flat.positions);
      return { world, positions: flat.positions, nodes, rings: flat.rings, bounds: layoutBounds(nodes, flat.positions) };
    }

    function treeLayout(tree, world, counts, spacing) {
      const positions = new Map();
      const rootX = world.width / 2;
      const contentHeight = treeLayerHeight(tree, spacing);
      const rootY = Math.max(config.layout.rootHeight / 2 + 48, (world.height - contentHeight) / 2 + config.layout.rootHeight / 2);
      const leafGap = treeLeafGap(tree, spacing);
      let layerTop = rootY + spacing.treeLevelGap;
      positions.set(model.ROOT_ID, { x: rootX, y: rootY });

      function place(node, nextLeafX) {
        const y = layerTop + (node.depth - 1) * spacing.treeLevelGap;
        if (!node.children.length) {
          positions.set(node.id, { x: nextLeafX, y });
          return { x: nextLeafX, nextLeafX: nextLeafX + leafGap };
        }
        const childXs = [];
        let cursor = nextLeafX;
        node.children.forEach((child) => {
          const placed = place(child, cursor);
          childXs.push(placed.x);
          cursor = placed.nextLeafX;
        });
        const x = childXs.reduce((sum, value) => sum + value, 0) / childXs.length;
        positions.set(node.id, { x, y });
        return { x, nextLeafX: cursor };
      }

      tree.children.forEach((primary) => {
        const branchLeafCount = Math.max(counts.get(primary.id), 1);
        place(primary, rootX - ((branchLeafCount - 1) * leafGap) / 2);
        layerTop += treeBranchSpan(primary, spacing);
      });
      return positions;
    }

    function flatRingLayout(tree, nodes, world, spacing) {
      const positions = new Map();
      const center = { x: world.width / 2, y: world.height / 2 };
      const radius = flatRingRadius(tree, spacing);
      positions.set(model.ROOT_ID, center);

      const ringNodes = nodes
        .map(({ node }) => node)
        .filter((node) => node.id !== model.ROOT_ID);
      const angles = spreadAngles(config.layout.ringStartAngle + Math.PI, Math.PI * 2, ringNodes.length);
      ringNodes.forEach((node, index) => {
        positions.set(node.id, polarPoint(center, angles[index], radius));
      });
      return {
        positions,
        center,
        rings: ringNodes.length ? [{ depth: 1, radius, center }] : []
      };
    }

    function flatRingRadius(tree, spacing) {
      const nodes = model.visibleNodes(tree).filter(({ node }) => node.id !== model.ROOT_ID);
      if (!nodes.length) return Math.max(spacing.treeLevelGap, spacing.ringBaseRadius);
      const nodeArc = Math.max(spacing.treeLeafGap, maxNodeWidth(tree) + spacing.ringNodeGap);
      return Math.max(spacing.ringBaseRadius, spacing.treeLevelGap) + (nodes.length * nodeArc) / (Math.PI * 2);
    }

    function ringLayout(tree, nodes, world, spacing) {
      const positions = new Map();
      const center = { x: world.width / 2, y: world.height / 2 };
      positions.set(model.ROOT_ID, center);
      const anglePlan = buildAnglePlan(tree);
      const radii = compactRingRadii(tree, spacing, anglePlan);
      const rings = Object.keys(radii)
        .map((depth) => ({ depth: Number(depth), radius: radii[depth], center }))
        .sort((a, b) => a.depth - b.depth);

      anglePlan.forEach((item, id) => {
        if (id === model.ROOT_ID) return;
        positions.set(id, polarPoint(center, item.angle, radii[item.depth]));
      });

      return { positions, center, rings };
    }

    function buildAnglePlan(tree) {
      const fullCircle = Math.PI * 2;
      const plan = new Map();
      plan.set(model.ROOT_ID, { angle: 0, span: fullCircle, depth: 0 });
      placeWeightedChildren(tree, config.layout.ringStartAngle, fullCircle, true);
      return plan;

      function placeWeightedChildren(parent, parentAngle, parentSpan, isRoot) {
        const children = parent.children;
        if (!children.length) return;
        const sectors = weightedSectors(children, parentAngle, parentSpan, isRoot);
        sectors.forEach((sector) => {
          plan.set(sector.node.id, {
            angle: sector.angle,
            span: sector.span,
            depth: sector.node.depth
          });
          placeWeightedChildren(sector.node, sector.angle, sector.span, false);
        });
      }
    }

    function weightedSectors(children, centerAngle, totalSpan, isRoot) {
      const minSpan = isRoot ? Math.min(config.layout.minPrimarySector, totalSpan / Math.max(children.length, 1)) : 0;
      const availableSpan = Math.max(0, totalSpan - minSpan * children.length);
      const weights = children.map(subtreeWeight);
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
      let cursor = centerAngle - totalSpan / 2;
      return children.map((child, index) => {
        const span = minSpan + availableSpan * (weights[index] / totalWeight);
        const angle = cursor + span / 2;
        cursor += span;
        return { node: child, angle, span };
      });
    }

    function subtreeWeight(node) {
      if (!node.children.length) return node.depth === 3 ? config.layout.leafWeight : 1;
      return 1 + node.children.reduce((sum, child) => sum + subtreeWeight(child), 0);
    }

    function spreadAngles(centerAngle, span, count) {
      const start = centerAngle - span / 2;
      return Array.from({ length: count }, (_, index) => start + (span * (index + 0.5)) / count);
    }

    function childWindow(parentSpan, childCount) {
      const target = Math.max(config.layout.minSiblingArc * Math.max(childCount - 1, 1), config.layout.minSiblingArc);
      return Math.min(Math.max(target, parentSpan * 0.68), Math.PI * 1.45, parentSpan * 0.92);
    }

    function childSectorSpan(parentSpan, childCount) {
      if (childCount <= 1) return Math.max(config.layout.minSiblingArc * 2, parentSpan * 0.72);
      return Math.max(config.layout.minSiblingArc, childWindow(parentSpan, childCount) / childCount);
    }

    function boundedSingleChildOffset(parentSpan, parentDepth) {
      const direction = parentDepth % 2 === 0 ? 1 : -1;
      const maxOffset = Math.max(config.layout.minSiblingArc / 2, parentSpan * 0.42);
      return direction * Math.min(config.layout.singleChildAngleOffset, maxOffset);
    }

    function polarPoint(center, angle, radius) {
      return {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      };
    }

    function compactRingRadii(tree, spacing, anglePlan) {
      const depthCounts = new Map();
      model.visibleNodes(tree).forEach(({ node }) => depthCounts.set(node.depth, (depthCounts.get(node.depth) || 0) + 1));
      const radii = {};
      for (let depth = 1; depth <= config.limits.maxDepth; depth += 1) {
        const count = depthCounts.get(depth) || 0;
        if (!count) continue;
        if (depth === 1) {
          const primaryWidth = Math.max(config.layout.nodeWidth, maxNodeWidthForDepth(tree, 1));
          radii[1] = Math.max(spacing.ringBaseRadius, radiusForMinimumAngle(primaryWidth, spacing, minSiblingAngleForDepth(tree, anglePlan, depth)));
        } else {
          radii[depth] = radii[depth - 1] + ringGapForDepth(depth, spacing);
        }
      }
      return radii;
    }

    function ringGapForDepth(depth, spacing) {
      if (depth === 2) return Math.min(spacing.ringDepthGap, config.layout.secondaryRingGap);
      if (depth === 3) return Math.min(Math.max(spacing.ringDepthGap, config.layout.leafRingGap), config.spacingLimits.ringDepthGap.max);
      return Math.min(spacing.ringDepthGap, config.layout.compactRingGap);
    }

    function minSiblingAngleForDepth(tree, anglePlan, depth) {
      let minAngle = Math.PI * 2;
      model.visibleNodes(tree).forEach(({ node }) => {
        if (!node.children.length || node.children[0].depth !== depth) return;
        const angles = node.children
          .map((child) => anglePlan.get(child.id))
          .filter(Boolean)
          .map((item) => item.angle)
          .sort((a, b) => a - b);
        if (angles.length <= 1) return;
        minAngle = Math.min(minAngle, smallestAngleGap(angles));
      });
      return Math.max(minAngle, 0.01);
    }

    function smallestAngleGap(angles) {
      const gaps = [];
      for (let index = 1; index < angles.length; index += 1) {
        gaps.push(angles[index] - angles[index - 1]);
      }
      gaps.push((Math.PI * 2) - angles[angles.length - 1] + angles[0]);
      return Math.min(...gaps);
    }

    function radiusForMinimumAngle(width, spacing, angle) {
      return (width + spacing.ringNodeGap + config.layout.minNodeDistance) / angle;
    }

    function maxNodeWidthForDepth(tree, depth) {
      return model.visibleNodes(tree).reduce((max, { node }) => {
        return node.depth === depth ? Math.max(max, nodeSize(node).width) : max;
      }, config.layout.nodeWidth);
    }

    function outerRingRadius(tree, spacing) {
      const radii = compactRingRadii(tree, spacing, buildAnglePlan(tree));
      let maxRadius = Math.max(...Object.values(radii), spacing.ringBaseRadius);
      return maxRadius + maxNodeWidth(tree) / 2 + ringBandGap(spacing);
    }

    function ringBandGap(spacing) {
      return Math.max(72, config.layout.nodeHeight + spacing.ringNodeGap);
    }

    function staggerCrowdedRingNodes(nodes, positions, center) {
      const ringItems = nodes
        .map(({ node }) => {
          if (node.id === model.ROOT_ID) return null;
          const point = positions.get(node.id);
          if (!point) return null;
          return {
            node,
            point,
            size: nodeSize(node),
            angle: Math.atan2(point.y - center.y, point.x - center.x)
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.angle - b.angle);
      if (ringItems.length < 2) return;

      const crowded = new Set();
      for (let index = 0; index < ringItems.length; index += 1) {
        const next = ringItems[(index + 1) % ringItems.length];
        if (paddedBoxesOverlap(ringItems[index], next, config.layout.overlapPadding)) {
          crowded.add(ringItems[index]);
          crowded.add(next);
        }
      }

      ringItems.forEach((item, index) => {
        if (!crowded.has(item)) return;
        const dx = item.point.x - center.x;
        const dy = item.point.y - center.y;
        const distance = Math.hypot(dx, dy) || 1;
        const direction = index % 2 === 0 ? 1 : -1;
        const nudge = direction * config.layout.overlapStagger;
        item.point.x += (dx / distance) * nudge;
        item.point.y += (dy / distance) * nudge;
      });
    }

    function paddedBoxesOverlap(first, second, padding) {
      return Math.abs(second.point.x - first.point.x) < (first.size.width + second.size.width) / 2 + padding &&
        Math.abs(second.point.y - first.point.y) < (first.size.height + second.size.height) / 2 + padding;
    }

    function resolveNodeOverlaps(nodes, positions) {
      const items = nodes
        .map(({ node }) => {
          const point = positions.get(node.id);
          if (!point) return null;
          return { node, point, size: nodeSize(node) };
        })
        .filter(Boolean);
      const padding = config.layout.overlapPadding;

      for (let pass = 0; pass < config.layout.overlapResolvePasses; pass += 1) {
        let moved = false;
        for (let firstIndex = 0; firstIndex < items.length; firstIndex += 1) {
          for (let secondIndex = firstIndex + 1; secondIndex < items.length; secondIndex += 1) {
            const first = items[firstIndex];
            const second = items[secondIndex];
            const overlap = overlapVector(first, second, padding);
            if (!overlap) continue;
            separateItems(first, second, overlap);
            moved = true;
          }
        }
        if (!moved) return;
      }
    }

    function overlapVector(first, second, padding) {
      const dx = second.point.x - first.point.x;
      const dy = second.point.y - first.point.y;
      const overlapX = (first.size.width + second.size.width) / 2 + padding - Math.abs(dx);
      const overlapY = (first.size.height + second.size.height) / 2 + padding - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) return null;
      if (overlapX < overlapY) {
        return { x: (dx >= 0 ? 1 : -1) * (overlapX + config.layout.overlapMinNudge), y: 0 };
      }
      return { x: 0, y: (dy >= 0 ? 1 : -1) * (overlapY + config.layout.overlapMinNudge) };
    }

    function separateItems(first, second, overlap) {
      if (first.node.id === model.ROOT_ID && second.node.id === model.ROOT_ID) return;
      if (first.node.id === model.ROOT_ID) {
        second.point.x += overlap.x;
        second.point.y += overlap.y;
        return;
      }
      if (second.node.id === model.ROOT_ID) {
        first.point.x -= overlap.x;
        first.point.y -= overlap.y;
        return;
      }
      first.point.x -= overlap.x / 2;
      first.point.y -= overlap.y / 2;
      second.point.x += overlap.x / 2;
      second.point.y += overlap.y / 2;
    }

    function layoutBounds(nodes, positions) {
      const boxes = nodes
        .map(({ node }) => {
          const point = positions.get(node.id);
          if (!point) return null;
          const size = nodeSize(node);
          return {
            left: point.x - size.width / 2,
            right: point.x + size.width / 2,
            top: point.y - size.height / 2,
            bottom: point.y + size.height / 2
          };
        })
        .filter(Boolean);
      if (!boxes.length) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      const left = Math.min(...boxes.map((box) => box.left));
      const right = Math.max(...boxes.map((box) => box.right));
      const top = Math.min(...boxes.map((box) => box.top));
      const bottom = Math.max(...boxes.map((box) => box.bottom));
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    }

    return {
      layout,
      nodeSize,
      maxNodeWidth
    };
  }

  RingMapChart.createLayoutEngine = createLayoutEngine;
})(window);
