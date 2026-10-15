const DATA_URL = new URL('./preprocessed_public_health_1000_records.csv', document.currentScript.src).href;
const REGION_FIELDS = [
  ['Region_East', 'East'],
  ['Region_North', 'North'],
  ['Region_South', 'South'],
  ['Region_West', 'West'],
];
const PROGRAM_FIELDS = [
  ['Health_Program_Diabetes Prevention', 'Diabetes prevention'],
  ['Health_Program_General Health Screening', 'General health screening'],
  ['Health_Program_Maternal Health', 'Maternal health'],
  ['Health_Program_Vaccination', 'Vaccination'],
];
const AGE_GROUP_FIELDS = [
  ['Age_Group_18-29', '18–29'],
  ['Age_Group_30-44', '30–44'],
  ['Age_Group_45-59', '45–59'],
  ['Age_Group_60+', '60+'],
];
const numberFormat = new Intl.NumberFormat('en-US');
const appState = { records: [], view: 'overview', search: '', pageSize: 100, role: 'admin', profile: null };

const byId = (id) => document.getElementById(id);
const sum = (records, field) => records.reduce((total, record) => total + (Number(record[field]) || 0), 0);
const average = (records, field) => records.length ? sum(records, field) / records.length : 0;
const formatNumber = (value) => numberFormat.format(Math.round(value));
const formatPercent = (value) => `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function oneHotLabel(record, fields, fallback) {
  const matches = fields.filter(([field]) => Number(record[field]) === 1).map(([, label]) => label);
  if (matches.length > 1) return 'Multiple coded values';
  return matches[0] || fallback;
}

function regionFor(record) { return oneHotLabel(record, REGION_FIELDS, 'Not coded'); }
function programFor(record) { return oneHotLabel(record, PROGRAM_FIELDS, 'Not coded'); }
function ageGroupFor(record) {
  const encoded = oneHotLabel(record, AGE_GROUP_FIELDS, '');
  if (encoded) return encoded;
  const age = Number(record.Age);
  if (!Number.isFinite(age)) return 'Not coded';
  if (age < 30) return '18–29';
  if (age < 45) return '30–44';
  if (age < 60) return '45–59';
  return '60+';
}
function genderFor(record) { return Number(record.Gender_Male) === 1 ? 'Male' : 'Female'; }

function filteredRecords() {
  const region = byId('region-filter').value;
  const program = byId('program-filter').value;
  const age = byId('age-filter').value;
  const gender = byId('gender-filter').value;
  return appState.records.filter((record) => {
    const matchesRegion = region === 'all' || regionFor(record) === region;
    const matchesProgram = program === 'all' || programFor(record) === program;
    const matchesAge = age === 'all' || ageGroupFor(record) === age;
    const matchesGender = gender === 'all' || genderFor(record) === gender;
    return matchesRegion && matchesProgram && matchesAge && matchesGender;
  });
}

function addFilterOptions(select, fields, labeler) {
  const labels = new Set(appState.records.map((record) => labeler(record)));
  fields.map(([, label]) => label).filter((label) => labels.has(label)).forEach((label) => {
    const option = document.createElement('option');
    option.value = label;
    option.textContent = label;
    select.append(option);
  });
}

function renderKpis(records) {
  const outcome = average(records, 'Overall_Result_Percentage');
  const referrals = sum(records, 'Hospital_Referral');
  const followups = sum(records, 'Referral_Followup');
  const kpis = [
    ['Participants', sum(records, 'Participant_Count'), 'people represented', '#418d70'],
    ['Health checkups', sum(records, 'Health_Checkup'), 'screenings delivered', '#e5725d'],
    ['Vaccinations', sum(records, 'Vaccine_Received'), 'participants vaccinated', '#e9bd58'],
    ['Medical tests', sum(records, 'Total_Tests_Performed'), 'tests performed', '#aaa5ca'],
    ['Cases identified', sum(records, 'Health_Problem_Found'), 'participants flagged', '#e5725d'],
    ['Hospital referrals', referrals, 'referrals recorded', '#418d70'],
    ['Avg. outcome rate', formatPercent(outcome), 'mean result percentage', '#e9bd58'],
    ['Referral follow-up', formatPercent(referrals ? followups / referrals * 100 : 0), `${formatNumber(followups)} of ${formatNumber(referrals)} followed up`, '#aaa5ca'],
  ];
  byId('kpi-grid').innerHTML = kpis.map(([label, value, foot, accent]) => `
    <article class="kpi-card" style="--accent:${accent}"><div class="kpi-top"><span>${label}</span><i class="kpi-mark"></i></div>
      <div class="kpi-value">${typeof value === 'number' ? formatNumber(value) : value}</div><div class="kpi-foot">${foot}</div></article>`).join('');
}

function renderBarRows(container, rows, { maxValue = 0, colors = [] } = {}) {
  const scale = maxValue || Math.max(1, ...rows.map(([, value]) => value));
  container.innerHTML = rows.map(([label, value], index) => `
    <div class="bar-row"><span class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, value / scale * 100)}%;--bar-color:${colors[index % colors.length] || 'var(--green)'}"></div></div>
      <span class="bar-number">${formatNumber(value)}</span></div>`).join('');
}

function renderOverview(records) {
  const services = [
    ['Health checkups', sum(records, 'Health_Checkup')],
    ['Vaccinations', sum(records, 'Vaccine_Received')],
    ['Blood tests', sum(records, 'Blood_Test')],
    ['Sugar tests', sum(records, 'Sugar_Test')],
    ['Blood pressure tests', sum(records, 'BP_Test')],
  ];
  renderBarRows(byId('service-bars'), services, { maxValue: sum(records, 'Participant_Count'), colors: ['#418d70', '#e5725d', '#e9bd58', '#aaa5ca', '#80b6a0'] });

  const regionRows = REGION_FIELDS.map(([, label]) => [label, records.filter((record) => regionFor(record) === label).length]);
  const uncoded = records.filter((record) => regionFor(record) === 'Not coded').length;
  if (uncoded) regionRows.push(['Not coded', uncoded]);
  renderBarRows(byId('region-bars'), regionRows, { colors: ['#418d70', '#e5725d', '#e9bd58', '#aaa5ca', '#9aa69f'] });

  const ageRows = AGE_GROUP_FIELDS.map(([, label]) => [label, records.filter((record) => ageGroupFor(record) === label).length]);
  const uncodedAges = records.filter((record) => ageGroupFor(record) === 'Not coded').length;
  if (uncodedAges) ageRows.push(['Not coded', uncodedAges]);
  renderBarRows(byId('age-bars'), ageRows, { colors: ['#418d70', '#e5725d', '#e9bd58', '#aaa5ca', '#9aa69f'] });
  const genderRows = ['Female', 'Male'].map((label) => [label, records.filter((record) => genderFor(record) === label).length]);
  renderBarRows(byId('gender-bars'), genderRows, { colors: ['#e5725d', '#418d70'] });

  const cases = sum(records, 'Health_Problem_Found');
  const referrals = sum(records, 'Hospital_Referral');
  const followups = sum(records, 'Referral_Followup');
  if (byId('referral-flow').nextElementSibling?.classList.contains('flow-rate')) {
    byId('referral-flow').nextElementSibling.remove();
  }
  byId('referral-flow').innerHTML = [
    [formatNumber(cases), 'Cases identified'], [formatNumber(referrals), 'Referred'], [formatNumber(followups), 'Follow-up recorded'],
  ].map(([value, label], index) => `<div class="flow-step"><div class="flow-number">${value}</div><div class="flow-label">${label}</div></div>${index < 2 ? '<div class="flow-arrow" aria-hidden="true">→</div>' : ''}`).join('');
  const completion = referrals ? followups / referrals * 100 : 0;
  const rate = document.createElement('div');
  rate.className = 'flow-rate';
  rate.innerHTML = `Referral follow-up rate <strong>${formatPercent(completion)}</strong>`;
  byId('referral-flow').after(rate);

  const leadingRegion = [...regionRows].filter(([label]) => label !== 'Not coded').sort((a, b) => b[1] - a[1])[0];
  const leadingProgram = PROGRAM_FIELDS.map(([, label]) => [label, records.filter((record) => programFor(record) === label).length]).sort((a, b) => b[1] - a[1])[0];
  byId('insight-title').textContent = `${leadingRegion?.[0] || 'No region'} leads in recorded reach.`;
  byId('insight-copy').textContent = `${formatNumber(leadingRegion?.[1] || 0)} participant records are coded to ${leadingRegion?.[0] || 'a region'}. ${leadingProgram?.[0] || 'Program participation'} is the largest program group with ${formatNumber(leadingProgram?.[1] || 0)} records. The outcome score averages ${formatPercent(average(records, 'Overall_Result_Percentage'))}.`;
}

function groupRecords(records) {
  const groups = new Map();
  records.forEach((record) => {
    const region = regionFor(record);
    const program = programFor(record);
    const key = `${region}\u0000${program}`;
    if (!groups.has(key)) groups.set(key, { region, program, records: [] });
    groups.get(key).records.push(record);
  });
  return [...groups.values()].sort((a, b) => a.region.localeCompare(b.region) || a.program.localeCompare(b.program));
}

function renderGroups(records) {
  const groups = groupRecords(records);
  byId('group-count').textContent = `${groups.length} group${groups.length === 1 ? '' : 's'}`;
  byId('groups-body').innerHTML = groups.map((group) => {
    const rows = group.records;
    return `<tr><td>${escapeHtml(group.region)}</td><td>${escapeHtml(group.program)}</td><td class="table-number">${formatNumber(sum(rows, 'Participant_Count'))}</td><td class="table-number">${formatNumber(sum(rows, 'Health_Checkup'))}</td><td class="table-number">${formatNumber(sum(rows, 'Vaccine_Received'))}</td><td class="table-number">${formatNumber(sum(rows, 'Total_Tests_Performed'))}</td><td class="table-number">${formatNumber(sum(rows, 'Health_Problem_Found'))}</td><td class="table-number">${formatNumber(sum(rows, 'Hospital_Referral'))}</td><td class="outcome-chip">${formatPercent(average(rows, 'Overall_Result_Percentage'))}</td></tr>`;
  }).join('') || '<tr><td colspan="9">No matching records.</td></tr>';
}

function renderParticipants(records) {
  const query = appState.search.trim().toLowerCase();
  const matches = records.filter((record) => {
    if (!query) return true;
    return [regionFor(record), programFor(record), record.Age, genderFor(record), ageGroupFor(record), record.Overall_Result_Percentage, Number(record.Health_Problem_Found) === 1 ? 'case identified' : 'no case', Number(record.Hospital_Referral) === 1 ? 'referral' : 'no referral'].join(' ').toLowerCase().includes(query);
  });
  const visible = matches.slice(0, appState.pageSize);
  byId('participants-body').innerHTML = visible.map((record) => {
    const index = appState.records.indexOf(record) + 1;
    const chip = (active, yes, no = 'No') => `<span class="table-chip${active ? '' : ' off'}">${active ? yes : no}</span>`;
    return `<tr><td>PH-${String(index).padStart(4, '0')}</td><td class="table-number">${escapeHtml(record.Age)}</td><td>${escapeHtml(genderFor(record))}</td><td>${escapeHtml(regionFor(record))}</td><td>${escapeHtml(programFor(record))}</td><td>${chip(Number(record.Health_Checkup) === 1, 'Yes')}</td><td>${chip(Number(record.Vaccine_Received) === 1, 'Yes')}</td><td class="table-number">${formatNumber(Number(record.Total_Tests_Performed) || 0)}</td><td>${chip(Number(record.Health_Problem_Found) === 1, 'Found', 'None')}</td><td>${chip(Number(record.Hospital_Referral) === 1, 'Referred')}</td><td class="outcome-chip">${formatPercent(Number(record.Overall_Result_Percentage) || 0)}</td></tr>`;
  }).join('') || '<tr><td colspan="11">No matching records.</td></tr>';
  byId('table-pagination').innerHTML = `<span>Showing ${formatNumber(visible.length)} of ${formatNumber(matches.length)} matching records</span><span>Maximum 100 rows</span>`;
}

function renderAnalysis(records) {
  const participants = sum(records, 'Participant_Count');
  const checkups = sum(records, 'Health_Checkup');
  const cases = sum(records, 'Health_Problem_Found');
  const referrals = sum(records, 'Hospital_Referral');
  const followups = sum(records, 'Referral_Followup');
  const outcome = average(records, 'Overall_Result_Percentage');
  const cards = [
    ['Checkup coverage', formatPercent(participants ? checkups / participants * 100 : 0), `${formatNumber(checkups)} of ${formatNumber(participants)} participants`],
    ['Cases identified', formatPercent(participants ? cases / participants * 100 : 0), `${formatNumber(cases)} records flagged`],
    ['Referred after screening', formatPercent(cases ? referrals / cases * 100 : 0), `${formatNumber(referrals)} referrals recorded`],
    ['Referral follow-up', formatPercent(referrals ? followups / referrals * 100 : 0), `${formatNumber(followups)} of ${formatNumber(referrals)} followed up`],
  ];
  byId('analysis-cards').innerHTML = cards.map(([label, value, caption]) => `<article class="analysis-card"><p class="eyebrow">${label}</p><div class="analysis-value">${value}</div><div class="analysis-caption">${caption}</div></article>`).join('');

  const programRows = PROGRAM_FIELDS.map(([, label]) => [label, records.filter((record) => programFor(record) === label).length]);
  const noProgram = records.filter((record) => programFor(record) === 'Not coded').length;
  if (noProgram) programRows.push(['Not coded', noProgram]);
  renderBarRows(byId('program-bars'), programRows, { colors: ['#418d70', '#e5725d', '#e9bd58', '#aaa5ca', '#9aa69f'] });

  const highSugarFlag = sum(records, 'Health_Problem_Type_High Sugar');
  const uncodedRegions = records.filter((record) => regionFor(record) === 'Not coded').length;
  const uncodedPrograms = records.filter((record) => programFor(record) === 'Not coded').length;
  byId('quality-notes').innerHTML = [
    `<div class="quality-item"><span class="quality-bullet alert"></span><span><strong>Problem-type flag mismatch.</strong> “High Sugar” is flagged on ${formatNumber(highSugarFlag)} rows, versus ${formatNumber(cases)} rows with a health problem found. Validate this encoded field before using it for clinical conclusions.</span></div>`,
    `<div class="quality-item"><span class="quality-bullet"></span><span><strong>Region coverage.</strong> ${formatNumber(uncodedRegions)} ${uncodedRegions === 1 ? 'record has' : 'records have'} no single region label; ${formatNumber(uncodedPrograms)} have no single program label. Uncoded records remain visible in the totals.</span></div>`,
    '<div class="quality-item"><span class="quality-bullet"></span><span><strong>No event dates or camp IDs.</strong> This file supports cross-sectional summaries, not time trends or named-camp comparisons.</span></div>',
  ].join('');

  byId('analysis-records').textContent = `${formatNumber(participants)} PARTICIPANTS`;
  byId('summary-copy').textContent = `Across ${formatNumber(participants)} participant records, ${formatNumber(checkups)} health checkups were recorded (${formatPercent(participants ? checkups / participants * 100 : 0)} coverage). ${formatNumber(cases)} participants were flagged with a health problem, and ${formatNumber(referrals)} hospital referrals were recorded. ${formatNumber(followups)} referrals have follow-up recorded (${formatPercent(referrals ? followups / referrals * 100 : 0)}). The mean overall result is ${formatPercent(outcome)}. Referral totals and identified-case totals are calculated from separate source flags; they are not assumed to be a one-to-one pathway.`;
}

function render() {
  const records = filteredRecords();
  const participantCount = sum(records, 'Participant_Count');
  byId('record-count').textContent = `${formatNumber(participantCount)} participant records`;
  byId('snapshot-period').textContent = records.length === appState.records.length ? 'ALL RECORDS' : 'FILTERED VIEW';
  renderKpis(records);
  renderOverview(records);
  renderGroups(records);
  renderParticipants(records);
  renderAnalysis(records);
}

function applyTheme(theme) {
  const activeTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = activeTheme;
  const dark = activeTheme === 'dark';
  const toggle = byId('theme-toggle');
  toggle.setAttribute('aria-pressed', String(dark));
  toggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
  toggle.innerHTML = dark ? '☀ <span>Light mode</span>' : '☾ <span>Dark mode</span>';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#101815' : '#173d35';
  localStorage.setItem('fieldwork-theme', activeTheme);
}

function setView(view) {
  appState.view = view;
  document.querySelectorAll('.nav-link').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.view-section').forEach((section) => {
    const active = section.id === `view-${view}`;
    section.classList.toggle('active', active);
    section.hidden = !active;
  });
  const current = view === 'camps' ? (appState.role === 'user' ? 'PROGRAMS' : 'PROGRAM GROUPS') : view === 'analysis' ? (appState.role === 'user' ? 'STATISTICAL ANALYSIS' : 'ANALYSIS & OUTCOMES') : view === 'profile' ? 'PROFILE' : view === 'reports' ? 'REPORTS' : view.toUpperCase();
  byId('breadcrumb-current').textContent = current;
  const titles = { overview: ['A pulse on public health.', 'One thousand participant records. A practical view of care delivered and outcomes reached.'], camps: ['Program groups.', 'Explore participant-level reach and outcomes across encoded region and program groups.'], participants: ['Participant records.', 'Search the preprocessed source data and review individual service and outcome flags.'], analysis: ['Analysis & outcomes.', 'A transparent summary of screening, referral follow-up, outcome rates, and data quality.'], profile: ['Your Account Details', 'View and manage your account information and personal details.'], reports: ['Generate Reports', 'Export participant data or print the current report.'] };
  byId('page-title').textContent = titles[view][0];
  byId('page-subtitle').textContent = titles[view][1];
  const profilePage = view === 'profile' || view === 'reports';
  byId('dashboard-heading').hidden = profilePage;
  byId('dashboard-filters').hidden = profilePage;
  document.querySelector('.breadcrumbs span:first-child').textContent = appState.role === 'user' ? 'USER' : 'PUBLIC HEALTH';
  if (view === 'reports') renderReport();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderReport() {
  const records = filteredRecords();
  const participants = sum(records, 'Participant_Count');
  const checkups = sum(records, 'Health_Checkup');
  const vaccinations = sum(records, 'Vaccine_Received');
  const cases = sum(records, 'Health_Problem_Found');
  const referrals = sum(records, 'Hospital_Referral');
  const followups = sum(records, 'Referral_Followup');
  const outcome = average(records, 'Overall_Result_Percentage');
  const reportDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  const userName = appState.profile?.name || sessionStorage.getItem('fieldwork-user') || 'User';
  byId('report-period').textContent = records.length === appState.records.length ? 'ALL USER RECORDS' : 'FILTERED USER VIEW';
  byId('report-prepared-for').textContent = userName;
  byId('report-generated-at').textContent = reportDate;
  byId('report-record-total').textContent = formatNumber(participants);

  const kpis = [
    ['Participants', participants, 'participant records'],
    ['Health checkups', checkups, `${formatPercent(participants ? checkups / participants * 100 : 0)} coverage`],
    ['Cases identified', cases, 'health issues flagged'],
    ['Hospital referrals', referrals, `${formatNumber(followups)} with follow-up`],
    ['Average outcome', formatPercent(outcome), 'mean result percentage'],
  ];
  byId('report-kpis').innerHTML = kpis.map(([label, value, note]) => `<article class="report-kpi"><span>${escapeHtml(label)}</span><strong>${typeof value === 'number' ? formatNumber(value) : value}</strong><small>${escapeHtml(note)}</small></article>`).join('');
  byId('report-summary-copy').textContent = `The current dataset contains ${formatNumber(participants)} participant records. ${formatNumber(checkups)} health checkups were recorded (${formatPercent(participants ? checkups / participants * 100 : 0)} coverage), alongside ${formatNumber(vaccinations)} vaccinations. ${formatNumber(cases)} records were flagged with a health problem and ${formatNumber(referrals)} hospital referrals were recorded; ${formatNumber(followups)} referrals have follow-up recorded (${formatPercent(referrals ? followups / referrals * 100 : 0)}). The mean overall result is ${formatPercent(outcome)}.`;

  const regionRows = REGION_FIELDS.map(([, label]) => ({ label, rows: records.filter((record) => regionFor(record) === label) }));
  const uncodedRegionRows = records.filter((record) => regionFor(record) === 'Not coded');
  if (uncodedRegionRows.length) regionRows.push({ label: 'Not coded', rows: uncodedRegionRows });
  byId('report-regions-body').innerHTML = regionRows.map(({ label, rows }) => `<tr><td>${escapeHtml(label)}</td><td class="table-number">${formatNumber(sum(rows, 'Participant_Count'))}</td><td class="table-number">${formatNumber(sum(rows, 'Health_Checkup'))}</td><td class="table-number">${formatNumber(sum(rows, 'Hospital_Referral'))}</td></tr>`).join('') || '<tr><td colspan="4">No matching records.</td></tr>';

  const programRows = PROGRAM_FIELDS.map(([, label]) => ({ label, rows: records.filter((record) => programFor(record) === label) }));
  const uncodedProgramRows = records.filter((record) => programFor(record) === 'Not coded');
  if (uncodedProgramRows.length) programRows.push({ label: 'Not coded', rows: uncodedProgramRows });
  byId('report-programs-body').innerHTML = programRows.map(({ label, rows }) => `<tr><td>${escapeHtml(label)}</td><td class="table-number">${formatNumber(sum(rows, 'Participant_Count'))}</td><td class="table-number">${formatNumber(sum(rows, 'Health_Checkup'))}</td><td class="table-number">${formatNumber(sum(rows, 'Vaccine_Received'))}</td></tr>`).join('') || '<tr><td colspan="4">No matching records.</td></tr>';
}

function exportCsv() {
  const headers = Object.keys(appState.records[0] || {});
  const filtered = filteredRecords();
  const csv = [headers, ...filtered.map((record) => headers.map((header) => record[header]))]
    .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'fieldwork-filtered-participants.csv';
  link.click();
  URL.revokeObjectURL(url);
}

async function loadData(role, email) {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`CSV request failed: ${response.status}`);
    const sourceRecords = parseCsv(await response.text());
    if (role === 'user') {
      const databaseKey = `fieldwork-user-database:${email.toLowerCase()}`;
      const savedRecords = localStorage.getItem(databaseKey);
      if (savedRecords === null) {
        appState.records = sourceRecords;
        localStorage.setItem(databaseKey, JSON.stringify(sourceRecords));
      } else {
        appState.records = JSON.parse(savedRecords);
        if (!Array.isArray(appState.records)) throw new Error('The user database is invalid.');
      }
    } else {
      appState.records = sourceRecords;
    }
    if (!appState.records.length) throw new Error('The CSV has no participant rows.');
    ['region-filter', 'program-filter', 'age-filter'].forEach((id) => {
      const select = byId(id);
      while (select.options.length > 1) select.remove(1);
    });
    addFilterOptions(byId('region-filter'), REGION_FIELDS, regionFor);
    addFilterOptions(byId('program-filter'), PROGRAM_FIELDS, programFor);
    addFilterOptions(byId('age-filter'), AGE_GROUP_FIELDS, ageGroupFor);
    byId('data-error').hidden = true;
    byId('dataset-status').textContent = role === 'user' ? 'User database connected' : 'Admin dataset connected';
    byId('dataset-count').textContent = `${formatNumber(sum(appState.records, 'Participant_Count'))} records loaded`;
    render();
    if (appState.view === 'reports') renderReport();
  } catch (error) {
    console.error(error);
    byId('data-error').hidden = false;
    byId('data-error').textContent = `Could not load the dataset (${error.message}). Confirm the CSV is beside app.js and refresh this page.`;
    byId('dataset-status').textContent = 'Dataset unavailable';
    byId('dataset-count').textContent = 'Check the CSV file';
    byId('record-count').textContent = 'Dataset unavailable';
  }
}

function formatProfileDate(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function getUserProfile(email) {
  const profileKey = `fieldwork-user-profile:${email.toLowerCase()}`;
  const savedProfile = localStorage.getItem(profileKey);
  if (savedProfile) {
    const profile = JSON.parse(savedProfile);
    if (profile && profile.email === email) return profile;
  }
  const name = email.split('@')[0].split(/[._-]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ') || 'User';
  const profile = { name, email, phone: '', joinedAt: new Date().toISOString(), activity: [] };
  localStorage.setItem(profileKey, JSON.stringify(profile));
  return profile;
}

function saveUserProfile() {
  if (!appState.profile) return;
  localStorage.setItem(`fieldwork-user-profile:${appState.profile.email.toLowerCase()}`, JSON.stringify(appState.profile));
}

function addProfileActivity(action, detail) {
  if (!appState.profile) return;
  appState.profile.activity.unshift({ action, detail, at: new Date().toISOString() });
  appState.profile.activity = appState.profile.activity.slice(0, 8);
  saveUserProfile();
}

function renderUserProfile() {
  const profile = appState.profile;
  if (!profile) return;
  const joinedDate = formatProfileDate(profile.joinedAt);
  byId('profile-display-name').textContent = profile.name;
  byId('profile-summary-email').textContent = profile.email;
  byId('profile-joined-date').textContent = joinedDate;
  byId('profile-info-name').textContent = profile.name;
  byId('profile-info-email').textContent = profile.email;
  byId('profile-info-phone').textContent = profile.phone || 'Not provided';
  byId('profile-info-joined').textContent = joinedDate;
  byId('profile-name-input').value = profile.name;
  byId('profile-email-input').value = profile.email;
  byId('profile-phone-input').value = profile.phone;
  byId('user-avatar').textContent = profile.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  byId('profile-activity').innerHTML = profile.activity.map((item) => {
    const date = new Date(item.at);
    const time = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(date);
    return `<li><span class="activity-icon" aria-hidden="true">▤</span><span class="activity-copy"><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.detail)}</small></span><span class="activity-time">${formatProfileDate(item.at)}<small>${time}</small></span></li>`;
  }).join('') || '<li class="activity-empty">No recent activity.</li>';
}

function enterWorkspace(role, email) {
  appState.role = role;
  byId('app').classList.toggle('user-mode', role === 'user');
  sessionStorage.setItem('fieldwork-user', email);
  sessionStorage.setItem('fieldwork-role', role);
  byId('admin-navigation').hidden = role === 'user';
  byId('user-navigation').hidden = role !== 'user';
  byId('workspace-label').textContent = role === 'user' ? 'USER WORKSPACE' : 'WORKSPACE';
  byId('workspace-tag').textContent = role === 'user' ? 'LOCAL WORKSPACE' : 'DATASET SNAPSHOT';
  byId('view-label').textContent = `${role.toUpperCase()} VIEW`;
  if (role === 'user') {
    appState.profile = getUserProfile(email);
    addProfileActivity('Logged in', 'Signed in to the local workspace');
    renderUserProfile();
  } else {
    appState.profile = null;
    byId('user-avatar').textContent = email.slice(0, 2).toUpperCase();
  }
  byId('login-screen').hidden = true;
  byId('app').hidden = false;
  setView(role === 'user' ? 'profile' : 'overview');
  loadData(role, email);
}

function updateLoginRole() {
  byId('login-access-label').textContent = `${byId('account-type').value.toUpperCase()} LOGIN`;
}

byId('account-type').addEventListener('change', updateLoginRole);
updateLoginRole();

byId('login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!byId('login-form').reportValidity()) return;
  const email = byId('email').value.trim();
  enterWorkspace(byId('account-type').value, email);
});

byId('logout-button').addEventListener('click', () => {
  sessionStorage.removeItem('fieldwork-user');
  sessionStorage.removeItem('fieldwork-role');
  byId('app').hidden = true;
  byId('login-screen').hidden = false;
  byId('login-form').reset();
});
byId('profile-edit-button').addEventListener('click', () => {
  byId('profile-name-input').focus();
  byId('profile-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
byId('profile-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!byId('profile-form').reportValidity() || !appState.profile) return;
  appState.profile.name = byId('profile-name-input').value.trim();
  appState.profile.phone = byId('profile-phone-input').value.trim();
  addProfileActivity('Profile updated', 'Saved account information');
  renderUserProfile();
  byId('profile-save-status').textContent = 'Changes saved in this browser.';
});
byId('password-help').addEventListener('click', () => {
  byId('password-note').hidden = !byId('password-note').hidden;
});
document.querySelectorAll('.nav-link[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.go)));
byId('region-filter').addEventListener('change', render);
byId('program-filter').addEventListener('change', render);
byId('age-filter').addEventListener('change', render);
byId('gender-filter').addEventListener('change', render);
byId('clear-filters').addEventListener('click', () => {
  byId('region-filter').value = 'all';
  byId('program-filter').value = 'all';
  byId('age-filter').value = 'all';
  byId('gender-filter').value = 'all';
  render();
});
byId('participant-search').addEventListener('input', (event) => {
  appState.search = event.target.value;
  renderParticipants(filteredRecords());
});
byId('export-button').addEventListener('click', exportCsv);
byId('user-export-button').addEventListener('click', exportCsv);
byId('generate-report-button').addEventListener('click', () => {
  renderReport();
  if (appState.profile) addProfileActivity('Report generated', 'Generated a participant and outcomes report');
});
byId('print-button').addEventListener('click', () => window.print());
byId('user-print-button').addEventListener('click', () => window.print());
byId('theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
applyTheme(localStorage.getItem('fieldwork-theme') || 'light');

if (sessionStorage.getItem('fieldwork-user')) {
  const role = sessionStorage.getItem('fieldwork-role') || 'admin';
  byId('account-type').value = role;
  updateLoginRole();
  enterWorkspace(role, sessionStorage.getItem('fieldwork-user'));
}
