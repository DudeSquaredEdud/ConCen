(function (global) {
  "use strict";

  const RingMapChart = global.RingMapChart;
  const { config, model, utils } = RingMapChart;

  function Renderer(svg, layoutEngine) {
    this.svg = svg;
    this.layoutEngine = layoutEngine;
    this.viewMode = "radial";
    this.viewBox = { x: 0, y: 0, width: config.layout.minViewportWidth, height: config.layout.minViewportHeight };
  }

  Renderer.prototype.render = function (data, handlers) {
    this.viewBox = data.viewBox;
    this.viewMode = data.viewMode || "radial";
    this.svg.setAttribute("viewBox", `${data.viewBox.x} ${data.viewBox.y} ${data.viewBox.width} ${data.viewBox.height}`);
    this.svg.replaceChildren();

    const defs = this.renderDefs();
    const guidesLayer = utils.svgEl("g", { class: "ring-guides", "aria-hidden": "true" });
    const edgesLayer = utils.svgEl("g", { class: "edges" });
    const pathEdgesLayer = utils.svgEl("g", { class: "path-edges" });
    const nodesLayer = utils.svgEl("g", { class: "nodes" });
    this.svg.append(defs, guidesLayer, edgesLayer, pathEdgesLayer, nodesLayer);

    (data.rings || []).forEach((ring) => this.renderRingGuide(guidesLayer, ring));
    data.nodes.forEach(({ node }) => {
      node.children.forEach((child) => this.renderEdge(edgesLayer, pathEdgesLayer, defs, data.tree, node, child, data.positions, data.focusContext));
    });
    data.nodes.forEach(({ node, parent }) => {
      this.renderNode(nodesLayer, data.tree, node, parent, data.positions.get(node.id), data.previousPositions && data.previousPositions.get(node.id), data.focusedId, data.animatedFocusId, data.animatedNewId, data.focusContext, data.mapRootIds, data.showStatusMarkers, data.showPriorityMarkers, data.viewMode, handlers);
    });
  };

  Renderer.prototype.renderDefs = function () {
    const defs = utils.svgEl("defs");
    const sketchFilter = utils.svgEl("filter", {
      id: "pencil-sketch",
      x: "-8%",
      y: "-8%",
      width: "116%",
      height: "116%"
    });
    sketchFilter.append(
      utils.svgEl("feTurbulence", {
        type: "fractalNoise",
        baseFrequency: "0.035",
        numOctaves: "2",
        seed: "7",
        result: "noise"
      }),
      utils.svgEl("feDisplacementMap", {
        in: "SourceGraphic",
        in2: "noise",
        scale: "1.8",
        xChannelSelector: "R",
        yChannelSelector: "G",
        result: "wobble"
      }),
      utils.svgEl("feTurbulence", {
        type: "fractalNoise",
        baseFrequency: "0.82",
        numOctaves: "3",
        seed: "19",
        result: "grain"
      }),
      utils.svgEl("feColorMatrix", {
        in: "grain",
        type: "matrix",
        values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .3 .3 .3 0 .55",
        result: "grainAlpha"
      }),
      utils.svgEl("feComposite", {
        in: "wobble",
        in2: "grainAlpha",
        operator: "in"
      })
    );
    defs.append(sketchFilter);
    config.textures.forEach((markup, index) => {
      const pattern = utils.svgEl("pattern", {
        id: `texture-${index}`,
        width: "8",
        height: "8",
        patternUnits: "userSpaceOnUse"
      });
      pattern.innerHTML = markup;
      defs.append(pattern);
    });
    return defs;
  };

  Renderer.prototype.renderRingGuide = function (layer, ring) {
    layer.append(utils.svgEl("circle", {
      class: `ring-guide depth-${ring.depth}`,
      cx: ring.center.x,
      cy: ring.center.y,
      r: ring.radius,
      opacity: config.layout.ringGuideOpacity
    }));
  };

  Renderer.prototype.renderEdge = function (layer, pathLayer, defs, tree, parent, child, positions, focusContext) {
    const from = positions.get(parent.id);
    const to = positions.get(child.id);
    if (!from || !to) return;
    const gradientId = `grad-${parent.id}-${child.id}`;
    const gradient = utils.svgEl("linearGradient", {
      id: gradientId,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      gradientUnits: "userSpaceOnUse"
    });
    gradient.append(
      utils.svgEl("stop", { offset: "0%", "stop-color": renderColor(tree, parent) }),
      utils.svgEl("stop", { offset: "100%", "stop-color": renderColor(tree, child) })
    );
    defs.append(gradient);
    const isPathEdge = Boolean(focusContext && focusContext.pathChildIds && focusContext.pathChildIds.has(child.id));
    const targetLayer = isPathEdge ? pathLayer : layer;
    const edge = utils.svgEl("path", {
      class: `edge ${isPathEdge ? "path-edge" : ""}`,
      d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
      stroke: `url(#${gradientId})`
    });
    targetLayer.append(edge, this.renderPencilEdge(parent.id + "-" + child.id, from, to, isPathEdge));
  };

  Renderer.prototype.renderPencilEdge = function (id, from, to, isPathEdge) {
    const group = utils.svgEl("g", {
      class: `pencil-edge ${isPathEdge ? "path-edge" : ""}`,
      "aria-hidden": "true"
    });
    const strokes = isPathEdge ? 5 : 4;
    for (let index = 0; index < strokes; index += 1) {
      group.append(utils.svgEl("path", {
        class: "pencil-stroke",
        d: pencilPath(id, from, to, index),
        "data-stroke": String(index)
      }));
    }
    return group;
  };

  Renderer.prototype.renderNode = function (layer, tree, node, parent, point, previousPoint, focusedId, animatedFocusId, animatedNewId, focusContext, mapRootIds, showStatusMarkers, showPriorityMarkers, viewMode, handlers) {
    if (!point) return;
    const size = this.layoutEngine.nodeSize(node, viewMode);
    const color = renderColor(tree, node);
    const hasMap = Boolean(mapRootIds && mapRootIds.has(node.sourceId || node.id));
    const hasNote = Boolean(node.note && node.note.trim());
    const isSibling = Boolean(focusContext && focusContext.siblingIds && focusContext.siblingIds.has(node.id) && node.id !== focusedId);
    const isPathNode = Boolean(focusContext && focusContext.pathNodeIds && focusContext.pathNodeIds.has(node.id));
    const group = utils.svgEl("g", {
      class: `node depth-${node.depth} view-${viewMode || "radial"} role-${viewRole(viewMode, node.depth)} ${node.depth === 3 ? "leaf" : ""} ${hasMap ? "has-map" : ""} ${hasNote ? "has-note" : ""} ${isSibling ? "sibling" : ""} ${isPathNode ? "path-node" : ""} ${node.id === focusedId ? "focused" : ""}`,
      transform: `translate(${point.x - size.width / 2}, ${point.y - size.height / 2})`,
      tabindex: "0",
      role: "button",
      "aria-label": node.label,
      "data-node-id": node.id
    });
    if (node.id === animatedFocusId) group.classList.add("focus-pop");
    if (node.id === animatedNewId) group.classList.add("node-enter");

    group.addEventListener("pointerdown", (event) => handlers.nodePointerDown(event, node.id));
    group.addEventListener("click", (event) => handlers.focus(node.id, event));
    group.addEventListener("dblclick", () => handlers.edit(node.id));

    if (previousPoint && Math.hypot(previousPoint.x - point.x, previousPoint.y - point.y) > 2) {
      const settle = utils.svgEl("animateTransform", {
        attributeName: "transform",
        type: "translate",
        additive: "sum",
        from: `${(previousPoint.x - point.x).toFixed(1)} ${(previousPoint.y - point.y).toFixed(1)}`,
        to: "0 0",
        dur: "170ms"
      });
      group.append(settle);
    }

    group.append(utils.svgEl("rect", {
      class: "node-box",
      width: size.width,
      height: size.height,
      fill: node.depth === 0 ? "var(--root-node-fill)" : "var(--node-fill)",
      stroke: color
    }));

    if (node.markerEnabled === true && showPriorityMarkers) {
      this.renderMetaMarker(group, node, size, showStatusMarkers, showPriorityMarkers);
    }

    if (hasMap) {
      group.append(utils.svgEl("line", {
        class: "map-marker",
        x1: 10,
        y1: size.height + 5,
        x2: size.width - 10,
        y2: size.height + 5,
        stroke: color
      }));
    }

    if (hasNote) {
      group.append(utils.svgEl("circle", {
        class: "note-marker",
        cx: size.width - 10,
        cy: 10,
        r: 3.2,
        fill: color
      }));
    }

    const title = utils.svgEl("title");
    title.textContent = node.label;
    group.append(title);

    const textureIndex = model.textureIndex(tree, node);
    if (textureIndex !== null && node.depth > 1) {
      group.append(utils.svgEl("rect", {
        class: "texture-fill",
        width: size.width,
        height: size.height,
        fill: `url(#texture-${textureIndex % config.textures.length})`,
        "pointer-events": "none"
      }));
    }

    if (node.depth === 3 && parent) {
      const marker = utils.svgEl("text", { class: "leaf-marker", x: 8, y: 11 });
      const index = parent.children.findIndex((child) => child.id === node.id);
      marker.textContent = config.romanNumerals[index] || String(index + 1);
      group.append(marker);
    }

    this.renderNodeText(group, node, size, viewMode, handlers);
    layer.append(group);
  };

  Renderer.prototype.renderNodeText = function (group, node, size, viewMode, handlers) {
    const profile = textProfile(viewMode, node.depth);
    if (!profile) {
      const label = utils.svgEl("text", { class: "node-label", x: size.width / 2, y: size.height / 2 });
      label.textContent = node.label;
      group.append(label);
      return;
    }

    const labelLines = markdownLines(node.label, profile.labelChars, profile.labelLines, "heading");
    const noteLines = markdownLines(node.note, profile.noteChars, profile.noteLines, "note");
    const contentHeight = labelLines.length * profile.labelLineHeight +
      (noteLines.length ? profile.noteGap + noteLines.length * profile.noteLineHeight : 0);
    let y = Math.max(profile.padY, (size.height - contentHeight) / 2);
    const x = profile.padX;
    const label = utils.svgEl("text", {
      class: "node-label",
      x,
      y: y + profile.labelLineHeight / 2,
      "text-anchor": "start",
      "dominant-baseline": "middle"
    });
    appendMarkdownTspans(label, labelLines, x, profile.labelLineHeight, handlers);
    group.append(label);

    if (!noteLines.length) return;
    y += labelLines.length * profile.labelLineHeight + profile.noteGap;
    const note = utils.svgEl("text", {
      class: "node-note-preview",
      x: profile.padX,
      y: y + profile.noteLineHeight / 2,
      "text-anchor": "start",
      "dominant-baseline": "middle"
    });
    appendMarkdownTspans(note, noteLines, profile.padX, profile.noteLineHeight, handlers);
    group.append(note);
  };

  Renderer.prototype.renderMetaMarker = function (group, node, size, showStatusMarkers, showPriorityMarkers) {
    const statusColor = {
      open: "#ef4444",
      active: "#22c55e",
      waiting: "#f59e0b",
      done: "#3b82f6"
    }[node.status || "open"] || "#ef4444";
    const priorityText = {
      low: "—",
      normal: "●",
      high: "!",
      critical: "!!!"
    }[node.priority || "normal"] || "•";
    const marker = utils.svgEl("g", {
      class: `meta-marker status-${node.status || "open"} priority-${node.priority || "normal"}`,
      transform: "translate(15, 12)"
    });
    if (showPriorityMarkers) {
      const text = utils.svgEl("text", {
        class: "priority-marker",
        x: 0,
        y: 0
      });
      if (showStatusMarkers) text.setAttribute("style", `fill: ${statusColor}`);
      text.textContent = priorityText;
      marker.append(text);
    }
    group.append(marker);
  };

  Renderer.prototype.editorRect = function (node, point, activeViewBox) {
    const size = this.layoutEngine.nodeSize(node, this.viewMode);
    const rect = this.svg.getBoundingClientRect();
    return {
      left: (point.x - size.width / 2 - activeViewBox.x) * (rect.width / activeViewBox.width),
      top: (point.y - size.height / 2 - activeViewBox.y) * (rect.height / activeViewBox.height),
      width: size.width * (rect.width / activeViewBox.width),
      height: size.height * (rect.height / activeViewBox.height)
    };
  };

  function renderColor(tree, node) {
    return node.depth === 0 ? "var(--root-node-fill)" : model.nodeColor(tree, node);
  }

  function viewRole(viewMode, depth) {
    const roles = {
      book: ["cover", "chapter", "section", "note"]
    };
    return (roles[viewMode] && roles[viewMode][depth]) || "node";
  }

  function textProfile(viewMode, depth) {
    const profiles = {
      book: {
        0: { padX: 24, padY: 24, labelChars: 25, labelLines: 2, noteChars: 54, noteLines: Infinity, labelLineHeight: 29, noteLineHeight: 16, noteGap: 14 },
        1: { padX: 19, padY: 17, labelChars: 25, labelLines: 2, noteChars: 44, noteLines: Infinity, labelLineHeight: 22, noteLineHeight: 15, noteGap: 11 },
        2: { padX: 17, padY: 16, labelChars: 30, labelLines: 2, noteChars: 48, noteLines: Infinity, labelLineHeight: 20, noteLineHeight: 14, noteGap: 10 },
        3: { padX: 15, padY: 14, labelChars: 26, labelLines: 2, noteChars: 40, noteLines: Infinity, labelLineHeight: 18, noteLineHeight: 13, noteGap: 8 }
      }
    };
    return profiles[viewMode] && profiles[viewMode][depth];
  }

  function appendMarkdownTspans(text, lines, x, lineHeight, handlers) {
    lines.forEach((line, lineIndex) => {
      if (!line.segments.length) return;
      let first = true;
      line.segments.forEach((segment) => {
        const attrs = {
          dy: lineIndex === 0 && first ? 0 : first ? lineHeight : 0
        };
        if (first) attrs.x = x;
        if (segment.bold || line.variant === "heading") attrs["font-weight"] = "900";
        if (segment.italic || line.variant === "quote") attrs["font-style"] = "italic";
        if (segment.strike) attrs["text-decoration"] = "line-through";
        if (segment.code) attrs.class = "markdown-code";
        if (segment.link) attrs.class = attrs.class ? attrs.class + " markdown-link" : "markdown-link";
        if (segment.highlight) attrs.class = attrs.class ? attrs.class + " markdown-highlight" : "markdown-highlight";
        const tspan = utils.svgEl("tspan", attrs);
        tspan.textContent = segment.text;
        if (segment.action && handlers.markdownAction) {
          tspan.setAttribute("role", "link");
          tspan.setAttribute("tabindex", "0");
          tspan.addEventListener("click", (event) => {
            event.stopPropagation();
            handlers.markdownAction(segment.action, event);
          });
          tspan.addEventListener("pointerdown", (event) => {
            event.stopPropagation();
          });
          tspan.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            handlers.markdownAction(segment.action, event);
          });
        }
        text.append(tspan);
        first = false;
      });
    });
  }

  function markdownLines(text, charsPerLine, maxLines, purpose) {
    if (!charsPerLine || !maxLines) return [];
    const clean = String(text || "").trim();
    if (!clean) return [];
    const limit = Number.isFinite(maxLines) ? maxLines : Infinity;
    const result = [];
    clean.split(/\n+/).forEach((rawLine) => {
      const block = blockMarkdown(rawLine, purpose);
      if (block.variant === "rule") {
        result.push({ segments: [markdownSegment("─".repeat(Math.max(32, charsPerLine)))], variant: "rule" });
        return;
      }
      wrapSegments(parseInlineMarkdown(block.text), charsPerLine).forEach((segments) => {
        result.push({ segments, variant: block.variant });
      });
    });
    return result.slice(0, limit);
  }

  function blockMarkdown(rawLine, purpose) {
    let text = String(rawLine || "").trim();
    let variant = purpose || "note";
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(text)) {
      return { text: "", variant: "rule" };
    }
    if (/^\|.*\|$/.test(text)) {
      return { text: text.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()).filter(Boolean).join("  •  "), variant };
    }
    const heading = text.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      return { text: heading[2], variant: "heading" };
    }
    const task = text.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (task) {
      return { text: (task[1].trim() ? "☑ " : "☐ ") + task[2], variant };
    }
    const unordered = text.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      return { text: "• " + unordered[1], variant };
    }
    const ordered = text.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      return { text: "• " + ordered[1], variant };
    }
    const quote = text.match(/^>\s+(.+)$/);
    if (quote) {
      return { text: quote[1], variant: "quote" };
    }
    return { text, variant };
  }

  function wrapSegments(segments, charsPerLine) {
    const lines = [];
    let line = [];
    let length = 0;
    segments.forEach((segment) => {
      const words = segment.text.split(/(\s+)/).filter(Boolean);
      words.forEach((word) => {
        const isSpace = /^\s+$/.test(word);
        const text = isSpace ? " " : word;
        if (!isSpace && length > 0 && length + text.length > charsPerLine) {
          lines.push(line);
          line = [];
          length = 0;
        }
        if (isSpace && length === 0) return;
        pushSegment(line, Object.assign({}, segment, { text }));
        length += text.length;
      });
    });
    if (line.length) lines.push(line);
    return lines.length ? lines : [[markdownSegment("")]];
  }

  function pushSegment(line, segment) {
    const previous = line[line.length - 1];
    if (previous &&
      previous.bold === segment.bold &&
      previous.italic === segment.italic &&
      previous.code === segment.code &&
      previous.strike === segment.strike &&
      previous.highlight === segment.highlight &&
      previous.link === segment.link &&
      JSON.stringify(previous.action) === JSON.stringify(segment.action)) {
      previous.text += segment.text;
      return;
    }
    line.push(segment);
  }

  function parseInlineMarkdown(text) {
    const source = String(text || "");
    const segments = [];
    const pattern = /(\*\*([^*]+)\*\*)|(__([^_]+)__)|(~~([^~]+)~~)|(==([^=]+)==)|(`([^`]+)`)|(!\[([^\]]*)\]\([^)]+\))|(\*([^*]+)\*)|(_([^_]+)_)|(\[([^\]]+)\]\([^)]+\))|(\[\[([^\]|]+)\|([^\]]+)\]\])|(\[\[([^\]]+)\]\])/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(source))) {
      if (match.index > cursor) segments.push(markdownSegment(source.slice(cursor, match.index)));
      if (match[2]) segments.push(markdownSegment(match[2], { bold: true }));
      else if (match[4]) segments.push(markdownSegment(match[4], { bold: true }));
      else if (match[6]) segments.push(markdownSegment(match[6], { strike: true }));
      else if (match[8]) segments.push(markdownSegment(match[8], { highlight: true }));
      else if (match[10]) segments.push(markdownSegment(match[10], { code: true }));
      else if (match[12] !== undefined) segments.push(markdownSegment("▣ " + (match[12] || "image"), { italic: true }));
      else if (match[14]) segments.push(markdownSegment(match[14], { italic: true }));
      else if (match[16]) segments.push(markdownSegment(match[16], { italic: true }));
      else if (match[18]) segments.push(markdownSegment(match[18], { link: true, action: { kind: "url", href: match[0].match(/\(([^)]+)\)$/)[1] } }));
      else if (match[21]) segments.push(markdownSegment(match[21], { link: true, action: { kind: "node", target: match[20] } }));
      else if (match[23]) segments.push(markdownSegment(match[23], { link: true, action: { kind: isHttpUrl(match[23]) ? "url" : "node", href: match[23], target: match[23] } }));
      cursor = pattern.lastIndex;
    }
    if (cursor < source.length) segments.push(markdownSegment(source.slice(cursor)));
    return segments.length ? segments : [markdownSegment(source)];
  }

  function markdownSegment(text, attrs) {
    return Object.assign({ text, bold: false, italic: false, code: false, strike: false, highlight: false, link: false, action: null }, attrs || {});
  }

  function isHttpUrl(value) {
    return /^https?:\/\/\S+$/i.test(String(value || "").trim());
  }

  function pencilPath(id, from, to, index) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const seed = hashString(id + ":" + index);
    const offsetA = seededRange(seed, -1.8, 1.8);
    const offsetB = seededRange(seed * 7, -2.2, 2.2);
    const bow = seededRange(seed * 13, -7, 7);
    const start = {
      x: from.x + nx * offsetA + seededRange(seed * 17, -1.4, 1.4),
      y: from.y + ny * offsetA + seededRange(seed * 19, -1.4, 1.4)
    };
    const end = {
      x: to.x + nx * offsetB + seededRange(seed * 23, -1.4, 1.4),
      y: to.y + ny * offsetB + seededRange(seed * 29, -1.4, 1.4)
    };
    const c1 = {
      x: from.x + dx * 0.34 + nx * (offsetA + bow),
      y: from.y + dy * 0.34 + ny * (offsetA + bow)
    };
    const c2 = {
      x: from.x + dx * 0.68 + nx * (offsetB - bow * 0.6),
      y: from.y + dy * 0.68 + ny * (offsetB - bow * 0.6)
    };
    return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededRange(seed, min, max) {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return min + (value - Math.floor(value)) * (max - min);
  }

  RingMapChart.Renderer = Renderer;
})(window);
