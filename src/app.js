/* ==========================================================================
   AI Occupational Exposure vs. Graduate Starting Pay | Standalone Data App
   Zero Tableau Extensions API dependencies. Built for GitHub Pages + Tableau Public.
   ========================================================================== */

const LOCAL_JSON_URL = './data.json';
const REMOTE_CSV_URL =
  'https://raw.githubusercontent.com/rfordatascience/tidytuesday/main/data/2026/2026-10-20/ai_salary_majors.csv';
const CACHE_KEY = 'tt_2026_w42_ai_majors_v1';
const FETCH_TIMEOUT_MS = 10000;

const FIELD_GROUPS = [
  {
    id: 'health',
    label: 'Healthcare & Life Sciences',
    color: '#2EE59D',
    cips: new Set(['26', '31', '51']),
    keywords: ['health', 'biology', 'biological', 'biomedical', 'medicine', 'nursing', 'parks', 'fitness', 'kinesiology']
  },
  {
    id: 'eng_biz',
    label: 'Engineering, Tech & Business',
    color: '#F5A623',
    cips: new Set(['04', '11', '14', '15', '22', '27', '40', '52']),
    keywords: ['engineering', 'computer', 'business', 'finance', 'math', 'statistics', 'physical science', 'architecture', 'legal', 'law']
  },
  {
    id: 'edu_soc',
    label: 'Education, Social & Trades',
    color: '#4CC9F0',
    cips: new Set(['01', '03', '12', '13', '19', '42', '43', '44', '45', '46', '47', '48', '49', '54']),
    keywords: ['education', 'social', 'psychology', 'agriculture', 'natural resource', 'culinary', 'trade', 'mechanic', 'construction', 'precision', 'transport', 'homeland', 'public admin', 'family', 'history']
  },
  {
    id: 'arts_comm',
    label: 'Arts, Comm & Humanities',
    color: '#E84A9C',
    cips: new Set(['05', '09', '10', '16', '23', '24', '25', '30', '38', '39', '50']),
    keywords: ['art', 'comm', 'journalism', 'english', 'language', 'humanities', 'liberal', 'philosophy', 'theology', 'library', 'ethnic', 'area', 'interdisciplinary']
  }
];

const METRIC_META = {
  ai_exposure: {
    label: 'AI Occupational Exposure (AIOE)',
    shortLabel: 'Overall AIOE'
  },
  ai_exposure_language: {
    label: 'Language-Model AI Exposure (Text Tasks)',
    shortLabel: 'Language AI'
  },
  ai_exposure_image: {
    label: 'Image-Generation AI Exposure (Visual Tasks)',
    shortLabel: 'Image AI'
  }
};

// SVG Layout Coordinates (matches viewBox="0 0 802 478"; 100% free of overlays)
const PLOT = {
  width: 802,
  height: 478,
  left: 64,
  right: 788,
  top: 18,
  bottom: 416
};

const state = {
  majors: [],
  activeMetric: 'ai_exposure',
  activeGroup: null,
  activeQuadrant: null,
  medianX: 0,
  medianY: 50000
};

// -----------------------------------------------------------------------------
// Column Lookup & Classification Helpers
// -----------------------------------------------------------------------------
function pick(row, keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
      return row[k];
    }
  }
  return null;
}

function toNumber(val) {
  if (val === null || val === undefined || val === '' || val === 'NA' || val === 'NaN') {
    return null;
  }
  const cleaned = typeof val === 'string' ? val.replace(/[$,]/g, '').trim() : val;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function classifyField(cip4, broadShort, broadFull) {
  const prefix = cip4 ? String(cip4).padStart(4, '0').slice(0, 2) : '';
  for (const grp of FIELD_GROUPS) {
    if (prefix && grp.cips.has(prefix)) {
      return grp;
    }
  }
  const haystack = `${broadShort || ''} ${broadFull || ''}`.toLowerCase();
  for (const grp of FIELD_GROUPS) {
    if (grp.keywords.some((kw) => haystack.includes(kw))) {
      return grp;
    }
  }
  return FIELD_GROUPS[2];
}

function computeMedian(values) {
  const valid = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!valid.length) return 0;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
}

function formatCurrency(val) {
  if (!Number.isFinite(val)) return 'N/A';
  return '$' + Math.round(val).toLocaleString('en-US');
}

function formatShortDollar(val) {
  if (!Number.isFinite(val)) return '';
  return '$' + Math.round(val / 1000) + 'k';
}

function formatSigned(val) {
  if (!Number.isFinite(val)) return 'N/A';
  const sign = val > 0 ? '+' : '';
  return sign + val.toFixed(2);
}

function ordinal(n) {
  const rounded = Math.round(n);
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`;
  switch (rounded % 10) {
    case 1: return `${rounded}st`;
    case 2: return `${rounded}nd`;
    case 3: return `${rounded}rd`;
    default: return `${rounded}th`;
  }
}

// -----------------------------------------------------------------------------
// RFC-4180 Quote-Aware CSV Parser
// -----------------------------------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r' && next === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ''));
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    if (line.length === 1 && line[0].trim() === '') continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = line[c] !== undefined ? line[c].trim() : '';
    }
    records.push(obj);
  }
  return records;
}

// -----------------------------------------------------------------------------
// Data Preparation
// -----------------------------------------------------------------------------
function normalizeRecords(rawRows) {
  const cleaned = [];
  for (const r of rawRows) {
    const major = pick(r, ['field_of_study', 'Field Of Study', 'Field of Study', 'major']);
    const salary1yr = toNumber(pick(r, ['median_starting_salary', 'Median Starting Salary']));
    const aiExposure = toNumber(pick(r, ['ai_exposure', 'Ai Exposure', 'AI Exposure']));
    if (!major || salary1yr === null || aiExposure === null) continue;

    const cip4 = pick(r, ['cip4', 'Cip4', 'CIP4']) || '';
    const broadShort = pick(r, ['broad_field_short', 'Broad Field Short']) || 'Other';
    const broadFull = pick(r, ['broad_field', 'Broad Field']) || broadShort;
    const group = classifyField(cip4, broadShort, broadFull);

    cleaned.push({
      cip4: String(cip4),
      field_of_study: major,
      broad_field_short: broadShort,
      broad_field: broadFull,
      groupId: group.id,
      groupLabel: group.label,
      color: group.color,
      median_starting_salary: salary1yr,
      median_salary_4yr: toNumber(pick(r, ['median_salary_4yr', 'Median Salary 4yr'])),
      ai_exposure: aiExposure,
      ai_exposure_percentile: toNumber(pick(r, ['ai_exposure_percentile', 'Ai Exposure Percentile'])),
      ai_exposure_language: toNumber(pick(r, ['ai_exposure_language', 'Ai Exposure Language'])),
      ai_exposure_image: toNumber(pick(r, ['ai_exposure_image', 'Ai Exposure Image'])),
      n_occupations: toNumber(pick(r, ['n_occupations', 'N Occupations'])),
      n_institutions: toNumber(pick(r, ['n_institutions', 'N Institutions'])),
      n_graduates: toNumber(pick(r, ['n_graduates', 'N Graduates'])) || 0
    });
  }
  return cleaned;
}

// -----------------------------------------------------------------------------
// SVG Helpers & Chart Rendering
// -----------------------------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, text = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  if (text !== null) {
    el.textContent = text;
  }
  return el;
}

function getScales(majors, metricKey) {
  const xVals = majors.map((m) => m[metricKey]).filter(Number.isFinite);
  const yVals = majors.map((m) => m.median_starting_salary).filter(Number.isFinite);

  const minX = Math.min(...xVals);
  const maxX = Math.max(...xVals);
  const spanX = Math.max(maxX - minX, 0.5);
  // Clean 6% linear breathing room on both sides (zero overlay boxes inside the plot)
  const domXMin = minX - spanX * 0.06;
  const domXMax = maxX + spanX * 0.06;

  const minY = Math.min(...yVals);
  const maxY = Math.max(...yVals);
  const spanY = Math.max(maxY - minY, 20000);
  // Honest linear Y domain with clean 7% breathing room
  const domYMin = Math.max(0, Math.floor((minY - spanY * 0.07) / 5000) * 5000);
  const domYMax = Math.ceil((maxY + spanY * 0.07) / 5000) * 5000;

  const plotW = PLOT.right - PLOT.left;
  const plotH = PLOT.bottom - PLOT.top;

  const xScale = (v) => PLOT.left + ((v - domXMin) / (domXMax - domXMin)) * plotW;
  const yScale = (v) => PLOT.bottom - ((v - domYMin) / (domYMax - domYMin)) * plotH;

  const maxGrads = Math.max(...majors.map((m) => m.n_graduates || 0), 1);
  const rScale = (g) => 3.6 + Math.sqrt(Math.max(g, 0) / maxGrads) * 4.2;

  return { xScale, yScale, rScale, domXMin, domXMax, domYMin, domYMax };
}

function getQuadrantKey(m, medX, medY, metricKey) {
  const xVal = m[metricKey];
  const highPay = m.median_starting_salary >= medY;
  const highExp = xVal >= medX;
  if (highPay && !highExp) return 'fortified';
  if (highPay && highExp) return 'paydays';
  if (!highPay && !highExp) return 'havens';
  return 'squeezed';
}

function getQuadrantLabel(quadKey) {
  switch (quadKey) {
    case 'fortified': return 'The Fortified Zone';
    case 'paydays': return 'High-Exposure Paydays';
    case 'havens': return 'Hands-On Havens';
    default: return 'The Squeezed Zone';
  }
}

function buildLegend() {
  const list = document.getElementById('legend-list');
  const resetBtn = document.getElementById('legend-reset');
  list.innerHTML = '';

  const counts = {};
  for (const m of state.majors) {
    counts[m.groupId] = (counts[m.groupId] || 0) + 1;
  }

  for (const grp of FIELD_GROUPS) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'legend-item-btn';
    btn.dataset.group = grp.id;

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = grp.color;
    swatch.style.boxShadow = `0 0 8px ${grp.color}`;

    const label = document.createElement('span');
    label.className = 'legend-label';
    label.textContent = grp.label;

    const qty = document.createElement('span');
    qty.className = 'legend-qty';
    qty.textContent = counts[grp.id] || 0;

    btn.append(swatch, label, qty);
    btn.addEventListener('click', () => {
      state.activeGroup = state.activeGroup === grp.id ? null : grp.id;
      applyHighlights();
    });

    li.appendChild(btn);
    list.appendChild(li);
  }

  resetBtn.addEventListener('click', () => {
    state.activeGroup = null;
    state.activeQuadrant = null;
    applyHighlights();
  });
}

function bindQuadrantCards() {
  document.querySelectorAll('.quadrant-card[data-quadrant]').forEach((card) => {
    card.addEventListener('click', () => {
      const q = card.dataset.quadrant;
      state.activeQuadrant = state.activeQuadrant === q ? null : q;
      applyHighlights();
    });
  });
}

function applyHighlights() {
  const hasFilter = Boolean(state.activeGroup || state.activeQuadrant);
  document.getElementById('legend-reset').hidden = !hasFilter;

  document.querySelectorAll('.legend-item-btn').forEach((btn) => {
    const isMatch = btn.dataset.group === state.activeGroup;
    btn.classList.toggle('is-active', Boolean(state.activeGroup && isMatch));
    btn.classList.toggle('is-dimmed', Boolean(state.activeGroup && !isMatch));
  });

  document.querySelectorAll('.quadrant-card[data-quadrant]').forEach((card) => {
    const isMatch = card.dataset.quadrant === state.activeQuadrant;
    card.classList.toggle('is-active', Boolean(state.activeQuadrant && isMatch));
    card.classList.toggle('is-dimmed', Boolean(state.activeQuadrant && !isMatch));
    card.setAttribute('aria-pressed', String(Boolean(state.activeQuadrant && isMatch)));
  });

  document.querySelectorAll('.major-dot').forEach((dot) => {
    const groupOk = !state.activeGroup || dot.dataset.group === state.activeGroup;
    const quadOk = !state.activeQuadrant || dot.dataset.quadrant === state.activeQuadrant;
    dot.classList.toggle('is-dimmed', !(groupOk && quadOk));
  });
}

function updateQuadrantCounts() {
  const metricKey = state.activeMetric;
  const counts = { fortified: 0, paydays: 0, havens: 0, squeezed: 0 };

  for (const m of state.majors) {
    const xVal = m[metricKey];
    if (!Number.isFinite(xVal)) continue;
    const q = getQuadrantKey(m, state.medianX, state.medianY, metricKey);
    counts[q]++;
  }

  document.getElementById('count-fortified').textContent = `${counts.fortified} majors`;
  document.getElementById('count-paydays').textContent = `${counts.paydays} majors`;
  document.getElementById('count-havens').textContent = `${counts.havens} majors`;
  document.getElementById('count-squeezed').textContent = `${counts.squeezed} majors`;
}

function renderScatter() {
  const svg = document.getElementById('scatter-svg');
  svg.innerHTML = '';

  const metricKey = state.activeMetric;
  const majors = state.majors.filter((m) => Number.isFinite(m[metricKey]));
  const scales = getScales(majors, metricKey);

  state.medianX = computeMedian(majors.map((m) => m[metricKey]));
  state.medianY = computeMedian(majors.map((m) => m.median_starting_salary));
  updateQuadrantCounts();

  const medPxX = scales.xScale(state.medianX);
  const medPxY = scales.yScale(state.medianY);

  // Defs: luminous glow filter + quadrant gradients + arrowheads
  const defs = svgEl('defs');

  const glow = svgEl('filter', { id: 'dot-glow', x: '-45%', y: '-45%', width: '190%', height: '190%' });
  glow.appendChild(svgEl('feGaussianBlur', { stdDeviation: '2.2', result: 'blur' }));
  const merge = svgEl('feMerge');
  merge.appendChild(svgEl('feMergeNode', { in: 'blur' }));
  merge.appendChild(svgEl('feMergeNode', { in: 'SourceGraphic' }));
  glow.appendChild(merge);
  defs.appendChild(glow);

  const quadGrads = [
    { id: 'q-tl', color: '#2EE59D', cx: '35%', cy: '40%' },
    { id: 'q-tr', color: '#F5A623', cx: '65%', cy: '40%' },
    { id: 'q-bl', color: '#4CC9F0', cx: '35%', cy: '65%' },
    { id: 'q-br', color: '#E84A9C', cx: '65%', cy: '65%' }
  ];
  for (const qg of quadGrads) {
    const rg = svgEl('radialGradient', { id: qg.id, cx: qg.cx, cy: qg.cy, r: '78%' });
    rg.appendChild(svgEl('stop', { offset: '0%', 'stop-color': qg.color, 'stop-opacity': '0.16' }));
    rg.appendChild(svgEl('stop', { offset: '100%', 'stop-color': qg.color, 'stop-opacity': '0.015' }));
    defs.appendChild(rg);
  }

  const mkArrow = (id, fill) => {
    const marker = svgEl('marker', {
      id,
      viewBox: '0 0 10 10',
      refX: '7',
      refY: '5',
      markerWidth: '6',
      markerHeight: '6',
      orient: 'auto-start-reverse'
    });
    marker.appendChild(svgEl('path', { d: 'M 0 1.5 L 8.5 5 L 0 8.5 z', fill }));
    defs.appendChild(marker);
  };
  mkArrow('arrow-axis', '#9eb5d9');
  mkArrow('arrow-magenta', '#E84A9C');

  svg.appendChild(defs);

  // Subtle quadrant glow rectangles
  const quadLayer = svgEl('g', { class: 'quadrant-layer' });
  quadLayer.appendChild(svgEl('rect', {
    x: PLOT.left,
    y: PLOT.top,
    width: Math.max(0, medPxX - PLOT.left),
    height: Math.max(0, medPxY - PLOT.top),
    fill: 'url(#q-tl)'
  }));
  quadLayer.appendChild(svgEl('rect', {
    x: medPxX,
    y: PLOT.top,
    width: Math.max(0, PLOT.right - medPxX),
    height: Math.max(0, medPxY - PLOT.top),
    fill: 'url(#q-tr)'
  }));
  quadLayer.appendChild(svgEl('rect', {
    x: PLOT.left,
    y: medPxY,
    width: Math.max(0, medPxX - PLOT.left),
    height: Math.max(0, PLOT.bottom - medPxY),
    fill: 'url(#q-bl)'
  }));
  quadLayer.appendChild(svgEl('rect', {
    x: medPxX,
    y: medPxY,
    width: Math.max(0, PLOT.right - medPxX),
    height: Math.max(0, PLOT.bottom - medPxY),
    fill: 'url(#q-br)'
  }));
  svg.appendChild(quadLayer);

  // Subtle Y ticks (decluttered, hairline only)
  const axisLayer = svgEl('g', { class: 'axis-layer' });
  const yStep = 20000;
  for (let yv = Math.ceil(scales.domYMin / yStep) * yStep; yv <= scales.domYMax; yv += yStep) {
    const py = scales.yScale(yv);
    if (py < PLOT.top + 8 || py > PLOT.bottom - 8) continue;
    axisLayer.appendChild(svgEl('line', {
      x1: PLOT.left - 5,
      y1: py,
      x2: PLOT.left,
      y2: py,
      stroke: 'rgba(158, 181, 217, 0.5)',
      'stroke-width': '1'
    }));
    axisLayer.appendChild(svgEl('text', {
      x: PLOT.left - 9,
      y: py + 3.5,
      'text-anchor': 'end',
      class: 'tick-label'
    }, formatShortDollar(yv)));
  }

  // Median crosshair lines
  axisLayer.appendChild(svgEl('line', {
    x1: medPxX,
    y1: PLOT.top,
    x2: medPxX,
    y2: PLOT.bottom,
    stroke: 'rgba(200, 214, 235, 0.3)',
    'stroke-width': '1.2',
    'stroke-dasharray': '4 4'
  }));
  axisLayer.appendChild(svgEl('line', {
    x1: PLOT.left,
    y1: medPxY,
    x2: PLOT.right,
    y2: medPxY,
    stroke: 'rgba(200, 214, 235, 0.3)',
    'stroke-width': '1.2',
    'stroke-dasharray': '4 4'
  }));

  // Clean inline median annotations tucked along the crosshair ends
  axisLayer.appendChild(svgEl('text', {
    x: medPxX + 6,
    y: PLOT.top + 12,
    class: 'median-tag'
  }, `Median exposure (${formatSigned(state.medianX)})`));

  axisLayer.appendChild(svgEl('text', {
    x: PLOT.right - 6,
    y: medPxY - 6,
    'text-anchor': 'end',
    class: 'median-tag'
  }, `Median pay (${formatShortDollar(state.medianY)})`));

  // Main Y Axis & X Axis lines with arrowheads
  axisLayer.appendChild(svgEl('line', {
    x1: PLOT.left,
    y1: PLOT.bottom,
    x2: PLOT.left,
    y2: PLOT.top,
    stroke: '#9eb5d9',
    'stroke-width': '1.6',
    'marker-end': 'url(#arrow-axis)'
  }));

  axisLayer.appendChild(svgEl('line', {
    x1: PLOT.left,
    y1: PLOT.bottom,
    x2: PLOT.right,
    y2: PLOT.bottom,
    stroke: '#9eb5d9',
    'stroke-width': '1.6',
    'marker-end': 'url(#arrow-axis)'
  }));

  // Y Axis Title (rotated)
  const yMid = (PLOT.top + PLOT.bottom) / 2;
  axisLayer.appendChild(svgEl('text', {
    x: 16,
    y: yMid,
    transform: `rotate(-90 16 ${yMid})`,
    'text-anchor': 'middle',
    class: 'axis-label-main'
  }, 'Median Starting Salary (1 Year Post-Grad)'));

  // X Axis Poles & Main Title
  axisLayer.appendChild(svgEl('text', {
    x: PLOT.left,
    y: PLOT.bottom + 24,
    'text-anchor': 'start',
    class: 'axis-pole-safe'
  }, 'AI-SAFE (LOW EXPOSURE)'));

  axisLayer.appendChild(svgEl('text', {
    x: PLOT.right,
    y: PLOT.bottom + 24,
    'text-anchor': 'end',
    class: 'axis-pole-exposed'
  }, 'HIGHLY EXPOSED (HIGH OVERLAP)'));

  axisLayer.appendChild(svgEl('line', {
    x1: 256,
    y1: PLOT.bottom + 20,
    x2: 538,
    y2: PLOT.bottom + 20,
    stroke: '#e84a9c',
    'stroke-width': '2',
    'marker-end': 'url(#arrow-magenta)'
  }));

  axisLayer.appendChild(svgEl('text', {
    x: (PLOT.left + PLOT.right) / 2,
    y: PLOT.bottom + 46,
    'text-anchor': 'middle',
    class: 'axis-label-main'
  }, METRIC_META[metricKey].label));

  svg.appendChild(axisLayer);

  // Scatter Marks Layer (sorted so smaller dots render on top of larger dots for hover precision)
  const sortedMajors = [...majors].sort((a, b) => (b.n_graduates || 0) - (a.n_graduates || 0));
  const dotLayer = svgEl('g', { class: 'dots-layer', filter: 'url(#dot-glow)' });

  for (const m of sortedMajors) {
    const cx = scales.xScale(m[metricKey]);
    const cy = scales.yScale(m.median_starting_salary);
    const r = scales.rScale(m.n_graduates);
    const quadKey = getQuadrantKey(m, state.medianX, state.medianY, metricKey);

    const circle = svgEl('circle', {
      cx: cx.toFixed(2),
      cy: cy.toFixed(2),
      r: r.toFixed(2),
      fill: m.color,
      'fill-opacity': '0.88',
      stroke: 'rgba(255,255,255,0.24)',
      'stroke-width': '0.6',
      class: 'major-dot',
      'data-group': m.groupId,
      'data-quadrant': quadKey
    });

    circle.addEventListener('mouseenter', (evt) => {
      circle.classList.add('is-hovered');
      circle.setAttribute('r', (r + 2.4).toFixed(2));
      showTooltip(evt, m, quadKey);
    });

    circle.addEventListener('mousemove', (evt) => {
      positionTooltip(evt);
    });

    circle.addEventListener('mouseleave', () => {
      circle.classList.remove('is-hovered');
      circle.setAttribute('r', r.toFixed(2));
      hideTooltip();
    });

    dotLayer.appendChild(circle);
  }

  svg.appendChild(dotLayer);
  applyHighlights();
}

// -----------------------------------------------------------------------------
// Plain-Language Narrative Tooltip (Zero Em Dashes)
// -----------------------------------------------------------------------------
const tooltipEl = document.getElementById('tooltip');

function showTooltip(evt, m, quadKey) {
  const quad = getQuadrantLabel(quadKey);
  const instClause = m.n_institutions ? ` across ${m.n_institutions.toLocaleString('en-US')} institutions` : '';
  const pctClause = Number.isFinite(m.ai_exposure_percentile)
    ? ` (${ordinal(m.ai_exposure_percentile)} percentile across all ${state.majors.length} majors)`
    : '';

  const narrative = `Graduates earn a median ${formatCurrency(m.median_starting_salary)} one year after graduation${instClause}. Its overall AI exposure score is ${formatSigned(m.ai_exposure)}${pctClause}.`;

  tooltipEl.innerHTML = `
    <div class="tooltip-title">${escapeHtml(m.field_of_study)}</div>
    <div class="tooltip-meta">
      <span class="tooltip-badge" style="background:${m.color}">${escapeHtml(m.broad_field_short)}</span>
      <span class="tooltip-quad">${escapeHtml(quad)}</span>
    </div>
    <p class="tooltip-narrative">${escapeHtml(narrative)}</p>
    <div class="tooltip-grid">
      <div>
        <span class="tooltip-stat-label">4-Yr Pay</span>
        <span class="tooltip-stat-val">${formatCurrency(m.median_salary_4yr)}</span>
      </div>
      <div>
        <span class="tooltip-stat-label">Language AI</span>
        <span class="tooltip-stat-val">${formatSigned(m.ai_exposure_language)}</span>
      </div>
      <div>
        <span class="tooltip-stat-label">Image AI</span>
        <span class="tooltip-stat-val">${formatSigned(m.ai_exposure_image)}</span>
      </div>
    </div>
  `;
  tooltipEl.hidden = false;
  positionTooltip(evt);
}

function positionTooltip(evt) {
  const pad = 14;
  const tw = tooltipEl.offsetWidth || 290;
  const th = tooltipEl.offsetHeight || 160;
  let left = evt.clientX + pad;
  let top = evt.clientY - th / 2;

  if (left + tw > window.innerWidth - pad) {
    left = evt.clientX - tw - pad;
  }
  if (top < pad) top = pad;
  if (top + th > window.innerHeight - pad) {
    top = window.innerHeight - th - pad;
  }

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function hideTooltip() {
  tooltipEl.hidden = true;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// -----------------------------------------------------------------------------
// Fast Local-First Data Loader (data.json -> Session Cache -> Remote CSV)
// -----------------------------------------------------------------------------
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRawDataset() {
  // 1. Prefer bundled local ./data.json when served over HTTP/HTTPS (instant same-origin load)
  if (window.location.protocol !== 'file:') {
    try {
      const localRes = await fetchWithTimeout(LOCAL_JSON_URL, 3000);
      if (localRes.ok) {
        const parsed = await localRes.json();
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (_err) {
      // Fall through cleanly if ./data.json is not bundled yet
    }
  }

  // 2. Reuse session-cached dataset if already downloaded in this tab
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (_err) {
    // Ignore storage restrictions inside sandboxed iframes
  }

  // 3. Fall back to the official TidyTuesday HTTPS CSV
  const remoteRes = await fetchWithTimeout(REMOTE_CSV_URL, FETCH_TIMEOUT_MS);
  if (!remoteRes.ok) {
    throw new Error(`HTTP ${remoteRes.status} while loading TidyTuesday CSV`);
  }
  const csvText = await remoteRes.text();
  const rows = parseCSV(csvText);

  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch (_err) {
    // Ignore storage quota or iframe restrictions
  }
  return rows;
}

// -----------------------------------------------------------------------------
// Bootstrap & Metric Toggle Wiring
// -----------------------------------------------------------------------------
function bindMetricToggles() {
  document.querySelectorAll('.metric-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextMetric = btn.dataset.metric;
      if (nextMetric === state.activeMetric) return;
      state.activeMetric = nextMetric;
      document.querySelectorAll('.metric-btn').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.metric === nextMetric);
      });
      renderScatter();
    });
  });
}

async function loadDataset() {
  const overlay = document.getElementById('status-overlay');
  const statusText = document.getElementById('status-text');

  try {
    const rawRows = await fetchRawDataset();
    state.majors = normalizeRecords(rawRows);
    if (!state.majors.length) {
      throw new Error('Dataset loaded, but no valid major records were found.');
    }

    document.getElementById('major-count-badge').textContent = state.majors.length;
    buildLegend();
    bindQuadrantCards();
    bindMetricToggles();
    renderScatter();
    overlay.hidden = true;
  } catch (err) {
    console.error('Data load error:', err);
    statusText.textContent = `Unable to load dataset: ${err.message}. Run prep_data.py to bundle local data.json alongside index.html.`;
  }
}

document.addEventListener('DOMContentLoaded', loadDataset);
