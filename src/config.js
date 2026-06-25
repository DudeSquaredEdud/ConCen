(function (global) {
  "use strict";

  const RingMapChart = global.RingMapChart || {};

  RingMapChart.config = {
    limits: {
      maxChildren: 12,
      maxDepth: 3,
      maxLabelLength: 80,
      maxNoteLength: 12000,
      maxTagLength: 24,
      maxTags: 8,
      maxStoredBytes: 5000000
    },
    storageKey: "ring-map-chart-v3",
    recentMindsKey: "ring-map-chart-recent-minds-v1",
    layout: {
      minViewportWidth: 900,
      minViewportHeight: 560,
      ringStartAngle: -Math.PI / 2,
      nodeWidth: 132,
      nodeHeight: 42,
      rootWidth: 168,
      rootHeight: 48,
      nodePadX: 26,
      ringGuideOpacity: 0.42,
      minSiblingArc: Math.PI / 5,
      singleChildAngleOffset: Math.PI / 4,
      compactRingGap: 108,
      secondaryRingGap: 92,
      leafRingGap: 128,
      ringFitPadding: 72,
      minNodeDistance: 42,
      minPrimarySector: Math.PI / 10,
      leafWeight: 1.35,
      overlapPadding: 18,
      overlapResolvePasses: 36,
      overlapMinNudge: 10,
      overlapStagger: 18
    },
    spacingDefaults: {
      treeLevelGap: 82,
      treeLeafGap: 110,
      ringBaseRadius: 110,
      ringDepthGap: 100,
      ringNodeGap: 28
    },
    spacingLimits: {
      treeLevelGap: { min: 40, max: 260 },
      treeLeafGap: { min: 60, max: 360 },
      ringBaseRadius: { min: 60, max: 500 },
      ringDepthGap: { min: 60, max: 500 },
      ringNodeGap: { min: 0, max: 200 }
    },
    appearanceDefaults: {
      nodeFontSize: 13,
      stylePreset: "glass",
      navigationMode: "outline",
      showStatusMarkers: false,
      showPriorityMarkers: true
    },
    appearanceLimits: {
      nodeFontSize: { min: 9, max: 22 }
    },
    stylePresets: {
      glass: { label: "Glass" },
      print: { label: "Print" },
      papery: { label: "Papery" },
      blueprint: { label: "Blueprint" },
      terminal: { label: "Terminal" },
      soft: { label: "Soft" }
    },
    navigationModes: {
      directional: { label: "Spatial arrows" },
      outline: { label: "Tree outline" },
      hybrid: { label: "Hybrid" }
    },
    themePresets: {
      light: {
        label: "Light",
        colorScheme: "light",
        tokens: {
          bg: "#f3f4f6",
          "surface-solid": "#ffffff",
          ink: "#1d1d1f",
          muted: "#6e737c",
          label: "#7b818c",
          field: "rgba(255, 255, 255, 0.86)",
          "canvas-bg": "#f7f8fa",
          "canvas-grid": "rgba(86, 98, 120, 0.055)",
          "node-fill": "rgba(255, 255, 255, 0.9)",
          "root-node-fill": "#111111",
          "root-node-ink": "#ffffff",
          "ring-guide": "rgba(94, 105, 124, 0.38)"
        }
      },
      dark: {
        label: "Dark",
        colorScheme: "dark",
        tokens: {
          bg: "#101114",
          "surface-solid": "#22242a",
          ink: "#f5f5f7",
          muted: "#a3a8b2",
          label: "#9096a2",
          field: "rgba(25, 27, 32, 0.84)",
          "canvas-bg": "#111318",
          "canvas-grid": "rgba(255, 255, 255, 0.045)",
          "node-fill": "rgba(32, 35, 42, 0.88)",
          "root-node-fill": "#111111",
          "root-node-ink": "#ffffff",
          "ring-guide": "rgba(169, 178, 194, 0.34)"
        }
      },
      graphite: {
        label: "Graphite",
        colorScheme: "dark",
        tokens: {
          bg: "#17181c",
          "surface-solid": "#26282e",
          ink: "#f4f4f6",
          muted: "#a7acb6",
          label: "#969ca7",
          field: "rgba(29, 31, 37, 0.9)",
          "canvas-bg": "#14161b",
          "canvas-grid": "rgba(255, 255, 255, 0.04)",
          "node-fill": "rgba(39, 42, 49, 0.9)",
          "root-node-fill": "#0b0c0f",
          "root-node-ink": "#ffffff",
          "ring-guide": "rgba(176, 184, 198, 0.3)"
        }
      },
      paper: {
        label: "Paper",
        colorScheme: "light",
        tokens: {
          bg: "#ebe7dc",
          "surface-solid": "#fbf8ef",
          ink: "#24211b",
          muted: "#746d60",
          label: "#837a6b",
          field: "rgba(255, 252, 242, 0.88)",
          "canvas-bg": "#f6f1e6",
          "canvas-grid": "rgba(91, 75, 45, 0.055)",
          "node-fill": "rgba(255, 252, 244, 0.92)",
          "root-node-fill": "#222018",
          "root-node-ink": "#fffaf0",
          "ring-guide": "rgba(109, 95, 70, 0.32)"
        }
      },
      contrast: {
        label: "High Contrast",
        colorScheme: "dark",
        tokens: {
          bg: "#000000",
          "surface-solid": "#111111",
          ink: "#ffffff",
          muted: "#d7d7d7",
          label: "#e6e6e6",
          field: "#050505",
          "canvas-bg": "#000000",
          "canvas-grid": "rgba(255, 255, 255, 0.08)",
          "node-fill": "#090909",
          "root-node-fill": "#ffffff",
          "root-node-ink": "#000000",
          "ring-guide": "rgba(255, 255, 255, 0.5)"
        }
      },
      custom: {
        label: "Custom",
        colorScheme: "light",
        tokens: {
          bg: "#f3f4f6",
          "surface-solid": "#ffffff",
          ink: "#1d1d1f",
          muted: "#6e737c",
          label: "#7b818c",
          field: "#ffffff",
          "canvas-bg": "#f7f8fa",
          "canvas-grid": "#e7eaf0",
          "node-fill": "#ffffff",
          "root-node-fill": "#111111",
          "root-node-ink": "#ffffff",
          "ring-guide": "#9aa3b2"
        }
      }
    },
    themeTokenControls: [
      { key: "bg", label: "Background" },
      { key: "surface-solid", label: "Surface" },
      { key: "ink", label: "Text" },
      { key: "muted", label: "Muted" },
      { key: "field", label: "Field" },
      { key: "canvas-bg", label: "Canvas" },
      { key: "node-fill", label: "Node" },
      { key: "root-node-fill", label: "Center" },
      { key: "ring-guide", label: "Guides" }
    ],
    colors: [
      "#e3342f",
      "#f59e0b",
      "#22c55e",
      "#06b6d4",
      "#6366f1",
      "#d946ef",
      "#f97316",
      "#84cc16",
      "#14b8a6",
      "#3b82f6",
      "#8b5cf6",
      "#ec4899"
    ],
    textures: [
      '<path d="M0 0 L8 8 M8 0 L0 8" stroke="rgba(0,0,0,.09)" stroke-width="1"/>',
      '<path d="M0 4 H8" stroke="rgba(0,0,0,.1)" stroke-width="1"/>',
      '<path d="M4 0 V8" stroke="rgba(0,0,0,.1)" stroke-width="1"/>',
      '<circle cx="2" cy="2" r="1" fill="rgba(0,0,0,.1)"/><circle cx="6" cy="6" r="1" fill="rgba(0,0,0,.1)"/>',
      '<path d="M0 8 L8 0" stroke="rgba(0,0,0,.1)" stroke-width="1.2"/>',
      '<path d="M0 0 H8 V8 H0 Z" fill="none" stroke="rgba(0,0,0,.08)" stroke-width="1"/>',
      '<path d="M0 2 H8 M0 6 H8" stroke="rgba(0,0,0,.1)" stroke-width="1"/>',
      '<path d="M2 0 V8 M6 0 V8" stroke="rgba(0,0,0,.1)" stroke-width="1"/>',
      '<path d="M0 0 L8 0 L0 8 Z" fill="rgba(0,0,0,.06)"/>',
      '<circle cx="4" cy="4" r="2.1" fill="none" stroke="rgba(0,0,0,.1)" stroke-width="1"/>',
      '<path d="M0 4 Q2 0 4 4 T8 4" fill="none" stroke="rgba(0,0,0,.1)" stroke-width="1"/>',
      '<path d="M4 0 L8 4 L4 8 L0 4 Z" fill="rgba(0,0,0,.06)"/>'
    ],
    romanNumerals: ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
  };

  global.RingMapChart = RingMapChart;
})(window);
