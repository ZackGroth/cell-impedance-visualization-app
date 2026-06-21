/**
 * realtime.js
 * Handles the web app controls, HC-05 serial packet parsing, impedance calculations,
 * chart updates, and live tables.
 */

const SERIAL_BAUD_RATE = 9600;
const DEMO_MODE = false;
const DEVICE_PALETTES = [
  { primary: '#36a2eb', secondary: '#ff6384' },
  { primary: '#4bc0c0', secondary: '#ff9f40' },
  { primary: '#9966ff', secondary: '#c9cbcf' },
  { primary: '#2e8b57', secondary: '#d45087' },
  { primary: '#7f6d00', secondary: '#dc3912' },
  { primary: '#3366cc', secondary: '#109618' },
  { primary: '#990099', secondary: '#0099c6' },
  { primary: '#dd4477', secondary: '#66aa00' },
  { primary: '#b82e2e', secondary: '#316395' },
  { primary: '#994499', secondary: '#22aa99' }
];
const DATABASE_NAME = 'sensor-monitor-hc05';
const DATABASE_STORE = 'packets';
const CSV_HEADERS = [
  'timestamp', 'deviceId', 'frequency', 'realImpedance',
  'imaginaryImpedance', 'magnitude', 'phase', 'relativeHumidity'
];

let bodeChart;
let nyquistChart;
let humidityChart;
let collectionTimer = null;
let collecting = false;

const impedanceRows = [];
const humidityRows = [];
const csvRecords = [];
const initialTimestampByDevice = new Map();
const databasePromise = openPacketDatabase().catch(error => {
  console.warn('Persistent browser storage is unavailable:', error);
  return null;
});

const nodes = {};

const els = {
  themeToggle: document.getElementById('themeToggle'),
  startCycleButton: document.getElementById('startCycleButton'),
  deviceCount: document.getElementById('deviceCount'),
  pairButtons: document.getElementById('pairButtons'),
  collectionInterval: document.getElementById('collectionInterval'),
  viewMode: document.getElementById('viewMode'),
  collectionStatus: document.getElementById('collectionStatus'),
  bodeView: document.getElementById('bodeView'),
  nyquistView: document.getElementById('nyquistView'),
  humidityView: document.getElementById('humidityView'),
  bodeTableBody: document.getElementById('bodeTableBody'),
  nyquistTableBody: document.getElementById('nyquistTableBody'),
  humidityTableBody: document.getElementById('humidityTableBody'),
  csvFileInput: document.getElementById('csvFileInput')
};

function openPacketDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not supported.'));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DATABASE_STORE, {
        keyPath: 'storageId',
        autoIncrement: true
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function persistRecords(records) {
  if (records.length === 0) return;
  const database = await databasePromise;
  if (!database) return;

  await new Promise((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, 'readwrite');
    const store = transaction.objectStore(DATABASE_STORE);
    records.forEach(record => store.add(record));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function readStoredRecords() {
  const database = await databasePromise;
  if (!database) return [];

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, 'readonly');
    const request = transaction.objectStore(DATABASE_STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function clearStoredRecords() {
  const database = await databasePromise;
  if (!database) return;

  await new Promise((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, 'readwrite');
    transaction.objectStore(DATABASE_STORE).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function numberFrom(data, keys) {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && value !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function stringFrom(data, keys, fallback = '') {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return fallback;
}

function elapsedTimestamp(timestamp, deviceId) {
  if (!initialTimestampByDevice.has(deviceId)) {
    initialTimestampByDevice.set(deviceId, timestamp);
  }

  return timestamp - initialTimestampByDevice.get(deviceId);
}

function normalizeImpedancePacket(data, fallbackDeviceId = 'ESP32') {
  const sourceTimestamp = numberFrom(data, ['sourceTimestamp', 'timestamp', 'time', 't']);
  const frequency = numberFrom(data, ['frequency', 'freq', 'frequencyHz']);
  const real = numberFrom(data, ['real', 'realImpedance', 'real impedance']);
  const imag = numberFrom(data, ['imag', 'imaginary', 'imaginaryImpedance', 'imaginary impedance']);
  const deviceId = stringFrom(data, ['deviceId', 'deviceID', 'id'], fallbackDeviceId);

  if (sourceTimestamp === null || frequency === null || real === null || imag === null) {
    return null;
  }

  const timestamp = elapsedTimestamp(sourceTimestamp, deviceId);
  const magnitude = Math.sqrt((real ** 2) + (imag ** 2));
  const phase = Math.atan2(imag, real) * (180 / Math.PI);
  const magnitudeDb = 20 * Math.log10(magnitude);

  return {
    timestamp,
    sourceTimestamp,
    timeSec: timestamp / 1000,
    deviceId,
    frequency,
    real,
    imag,
    magnitude,
    magnitudeDb,
    phase
  };
}

function normalizeHumidityPacket(data, fallbackDeviceId = 'ESP32') {
  const humidity = numberFrom(data, ['humidity', 'humidity %', 'relativeHumidity', 'relative humidity %', 'rh']);
  if (humidity === null) return null;

  const sourceTimestamp = numberFrom(data, ['sourceTimestamp', 'timestamp', 'time', 't']) ?? Date.now();
  const deviceId = stringFrom(data, ['deviceId', 'deviceID', 'id'], fallbackDeviceId);
  const timestamp = elapsedTimestamp(sourceTimestamp, deviceId);

  return {
    timestamp,
    sourceTimestamp,
    timeSec: timestamp / 1000,
    deviceId,
    humidity
  };
}

function formatTime(timestamp) {
  return `${(timestamp / 1000).toFixed(2)} s`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function trimRows(rows, maxRows = 200) {
  while (rows.length > maxRows) rows.shift();
}

function colorsForDevice(deviceId) {
  const configuredNode = Object.values(nodes).find(node => node.deviceId === deviceId);
  if (configuredNode) return DEVICE_PALETTES[configuredNode.index % DEVICE_PALETTES.length];

  const hash = [...deviceId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return DEVICE_PALETTES[hash % DEVICE_PALETTES.length];
}

function addPacket(data, fallbackDeviceId, options = {}) {
  const { persist = true, refresh = true } = options;
  const impedance = normalizeImpedancePacket(data, fallbackDeviceId);
  if (impedance) {
    impedanceRows.push(impedance);
    trimRows(impedanceRows);
  }

  const humidity = normalizeHumidityPacket(data, fallbackDeviceId);
  if (humidity) {
    humidityRows.push(humidity);
    trimRows(humidityRows);
  }

  if (!impedance && !humidity) {
    console.warn('Packet did not include supported data fields:', data);
    return null;
  }

  const record = {
    timestamp: impedance?.timestamp ?? humidity.timestamp,
    sourceTimestamp: impedance?.sourceTimestamp ?? humidity.sourceTimestamp,
    deviceId: impedance?.deviceId ?? humidity.deviceId,
    frequency: impedance?.frequency ?? null,
    realImpedance: impedance?.real ?? null,
    imaginaryImpedance: impedance?.imag ?? null,
    magnitude: impedance?.magnitude ?? null,
    phase: impedance?.phase ?? null,
    relativeHumidity: humidity?.humidity ?? null
  };

  csvRecords.push(record);
  if (persist) persistRecords([record]).catch(error => console.error(error));

  if (refresh && impedance) updateImpedanceViews();
  if (refresh && humidity) updateHumidityView();

  return record;
}

function updateImpedanceViews() {
  const sortedByFrequency = [...impedanceRows].sort((a, b) => a.frequency - b.frequency);
  const deviceIds = [...new Set(sortedByFrequency.map(row => row.deviceId))];

  bodeChart.data.datasets = deviceIds.flatMap(deviceId => {
    const rows = sortedByFrequency.filter(row => row.deviceId === deviceId);
    const colors = colorsForDevice(deviceId);
    return [
      {
        label: `${deviceId} |Z| (dB)`,
        yAxisID: 'magnitudeAxis',
        data: rows.map(row => ({ x: row.frequency, y: row.magnitudeDb })),
        borderColor: colors.primary,
        backgroundColor: colors.primary,
        pointRadius: 3,
        borderWidth: 2
      },
      {
        label: `${deviceId} Phase (deg)`,
        yAxisID: 'phaseAxis',
        data: rows.map(row => ({ x: row.frequency, y: row.phase })),
        borderColor: colors.secondary,
        backgroundColor: colors.secondary,
        pointRadius: 3,
        borderWidth: 2,
        borderDash: [5, 4]
      }
    ];
  });
  bodeChart.update('none');

  nyquistChart.data.datasets = deviceIds.map(deviceId => {
    const rows = sortedByFrequency.filter(row => row.deviceId === deviceId);
    const colors = colorsForDevice(deviceId);
    return {
      label: deviceId,
      data: rows.map(row => ({ x: row.real, y: -row.imag })),
      borderColor: colors.primary,
      backgroundColor: colors.primary,
      pointRadius: 4,
      borderWidth: 2,
      tension: 0.2
    };
  });
  nyquistChart.update('none');

  renderImpedanceTables();
}

function updateHumidityView() {
  const deviceIds = [...new Set(humidityRows.map(row => row.deviceId))];
  humidityChart.data.datasets = deviceIds.map(deviceId => {
    const rows = humidityRows.filter(row => row.deviceId === deviceId);
    const colors = colorsForDevice(deviceId);
    return {
      label: `${deviceId} humidity (%)`,
      data: rows.map(row => ({ x: row.timeSec, y: row.humidity })),
      borderColor: colors.primary,
      backgroundColor: colors.primary,
      pointRadius: 3,
      borderWidth: 2
    };
  });
  humidityChart.update('none');
  renderHumidityTable();
}

function renderImpedanceTables() {
  const rows = impedanceRows.slice(-80).map(row => `
    <tr>
      <td>${formatTime(row.timestamp)}</td>
      <td>${escapeHtml(row.deviceId)}</td>
      <td>${row.frequency.toFixed(2)}</td>
      <td>${row.real.toFixed(3)}</td>
      <td>${row.imag.toFixed(3)}</td>
      <td>${row.magnitude.toFixed(3)}</td>
      <td>${row.phase.toFixed(2)}</td>
    </tr>
  `).join('');

  els.bodeTableBody.innerHTML = rows;

  els.nyquistTableBody.innerHTML = impedanceRows.slice(-80).map(row => `
    <tr>
      <td>${formatTime(row.timestamp)}</td>
      <td>${escapeHtml(row.deviceId)}</td>
      <td>${row.frequency.toFixed(2)}</td>
      <td>${row.real.toFixed(3)}</td>
      <td>${(-row.imag).toFixed(3)}</td>
      <td>${row.magnitude.toFixed(3)}</td>
      <td>${row.phase.toFixed(2)}</td>
    </tr>
  `).join('');
}

function renderHumidityTable() {
  els.humidityTableBody.innerHTML = humidityRows.slice(-80).map(row => `
    <tr>
      <td>${formatTime(row.timestamp)}</td>
      <td>${escapeHtml(row.deviceId)}</td>
      <td>${row.humidity.toFixed(2)}</td>
    </tr>
  `).join('');
}

function setView(viewName) {
  const views = {
    bode: els.bodeView,
    nyquist: els.nyquistView,
    humidity: els.humidityView
  };

  Object.entries(views).forEach(([name, view]) => {
    view.classList.toggle('active', name === viewName);
  });

  requestAnimationFrame(() => {
    bodeChart?.resize();
    nyquistChart?.resize();
    humidityChart?.resize();
  });
}

function setStatus(message) {
  els.collectionStatus.textContent = message;
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function buildCsv(records) {
  const lines = [CSV_HEADERS.join(',')];
  records.forEach(record => {
    lines.push(CSV_HEADERS.map(header => escapeCsvValue(record[header])).join(','));
  });
  return lines.join('\r\n');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  row.push(field);
  if (row.some(value => value.trim() !== '')) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows.shift().map(header => header.trim().replace(/^\uFEFF/, ''));
  return rows.map(values => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ''])
  ));
}

function downloadCsv() {
  if (csvRecords.length === 0) {
    setStatus('There is no collected data to download.');
    return;
  }

  const blob = new Blob([buildCsv(csvRecords)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  link.href = url;
  link.download = `sensor-data-${timestamp}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus(`Downloaded ${csvRecords.length} stored records.`);
}

async function importCsv(file) {
  const rows = parseCsv(await file.text());
  const importedRecords = [];

  rows.forEach(row => {
    const deviceId = stringFrom(row, ['deviceId', 'deviceID', 'id'], 'IMPORTED');
    const record = addPacket(row, deviceId, { persist: false, refresh: false });
    if (record) importedRecords.push(record);
  });

  if (importedRecords.length === 0) {
    throw new Error('The CSV did not contain supported sensor rows.');
  }

  await persistRecords(importedRecords);
  updateImpedanceViews();
  updateHumidityView();
  setStatus(`Imported ${importedRecords.length} CSV records.`);
}

async function restoreStoredData() {
  const records = await readStoredRecords();
  records.forEach(record => {
    addPacket(record, record.deviceId || 'RESTORED', {
      persist: false,
      refresh: false
    });
  });

  if (records.length > 0) {
    updateImpedanceViews();
    updateHumidityView();
    setStatus(`Restored ${records.length} stored records.`);
  }
}

async function clearAllData() {
  const confirmed = window.confirm(
    'Clear all stored sensor data? This cannot be undone unless you downloaded a CSV.'
  );
  if (!confirmed) return;

  stopCollectionCycle();
  await clearStoredRecords();

  impedanceRows.length = 0;
  humidityRows.length = 0;
  csvRecords.length = 0;
  initialTimestampByDevice.clear();
  Object.values(nodes).forEach(node => {
    node.lastCollectedKey = null;
  });

  updateImpedanceViews();
  updateHumidityView();
  setStatus('All stored sensor data was cleared. Collection stopped.');
}

function slotForIndex(index) {
  return String.fromCharCode(65 + index);
}

function createNode(slot, index) {
  return {
    slot,
    index,
    label: `HC-05 ${slot}`,
    deviceId: `HC05_${slot}`,
    port: null,
    latestPacket: null,
    buffer: '',
    reader: null,
    receivedCount: 0,
    lastCollectedKey: null
  };
}

function renderPairButtons() {
  els.pairButtons.replaceChildren();

  Object.values(nodes).forEach(node => {
    const control = document.createElement('div');
    control.className = 'device-pair-control';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'device-name-input';
    nameInput.value = node.deviceId;
    nameInput.maxLength = 40;
    nameInput.placeholder = `Device ${node.slot}`;
    nameInput.setAttribute('aria-label', `${node.label} name`);
    nameInput.disabled = Boolean(node.port);
    nameInput.addEventListener('input', event => {
      node.deviceId = event.target.value;
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pair-button';
    button.dataset.pairSlot = node.slot;
    button.textContent = node.port ? `${node.label} Paired` : `Pair ${node.label}`;
    button.disabled = Boolean(node.port);
    if (node.port) button.classList.add('paired');
    button.addEventListener('click', () => {
      pairNode(node.slot).catch(error => setStatus(error.message));
    });

    control.append(nameInput, button);
    els.pairButtons.appendChild(control);
  });
}

function configureDeviceCount(count) {
  const requestedSlots = Array.from({ length: count }, (_, index) => slotForIndex(index));
  const removedSlots = Object.keys(nodes).filter(slot => !requestedSlots.includes(slot));

  if (removedSlots.some(slot => nodes[slot].port)) {
    els.deviceCount.value = String(Object.keys(nodes).length);
    setStatus('A paired device cannot be removed. Reload the page to reset paired ports.');
    return;
  }

  removedSlots.forEach(slot => delete nodes[slot]);
  requestedSlots.forEach((slot, index) => {
    if (!nodes[slot]) nodes[slot] = createNode(slot, index);
  });

  renderPairButtons();
  setStatus(`Configured ${count} HC-05 device slot(s).`);
}

async function pairNode(slot) {
  if (!navigator.serial) {
    throw new Error('Web Serial is not available in this browser.');
  }

  const node = nodes[slot];
  const deviceName = node.deviceId.trim();
  if (!deviceName) {
    throw new Error(`Enter a name for ${node.label} before pairing.`);
  }

  const duplicateName = Object.values(nodes).some(candidate => (
    candidate.slot !== slot
    && candidate.deviceId.trim().toLowerCase() === deviceName.toLowerCase()
  ));
  if (duplicateName) {
    throw new Error(`The device name "${deviceName}" is already in use.`);
  }

  node.deviceId = deviceName;
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: SERIAL_BAUD_RATE });

  node.port = port;
  startSerialReader(slot);

  renderPairButtons();
  setStatus(`${node.deviceId} serial port opened at ${SERIAL_BAUD_RATE} baud`);
}

async function startSerialReader(slot) {
  const node = nodes[slot];
  const decoder = new TextDecoder();
  node.reader = node.port.readable.getReader();

  try {
    while (node.port?.readable) {
      const { value, done } = await node.reader.read();
      if (done) break;

      node.buffer += decoder.decode(value, { stream: true });
      const lines = node.buffer.split('\n');
      node.buffer = lines.pop();

      for (const line of lines) {
        const packetText = line.trim();
        if (!packetText) continue;

        try {
          node.latestPacket = JSON.parse(packetText);
          node.receivedCount += 1;

          if (!collecting) {
            const reportedDeviceId = stringFrom(
              node.latestPacket,
              ['deviceId', 'deviceID', 'id'],
              'not provided'
            );
            setStatus(
              `${node.label} receiving as ${node.deviceId}`
              + ` (payload: ${reportedDeviceId}, ${node.receivedCount} packets)`
            );
          }
        } catch (error) {
          console.warn(`Invalid JSON from ${node.label}:`, packetText);
        }
      }
    }
  } catch (error) {
    setStatus(`${node.label} serial read failed: ${error.message}`);
  } finally {
    node.reader?.releaseLock();
    node.reader = null;
  }
}

function demoPacket(deviceId) {
  const timestamp = Date.now();
  const frequencyOptions = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  const frequency = frequencyOptions[impedanceRows.length % frequencyOptions.length];
  const resistance = 1000;
  const capacitance = 0.000001;
  const omega = 2 * Math.PI * frequency;
  const imag = -1 / (omega * capacitance);

  return {
    timestamp,
    frequency,
    real: resistance,
    imag,
    deviceId,
    humidity: 52 + Math.sin(impedanceRows.length / 3) * 1.5
  };
}

async function collectOnce() {
  try {
    if (DEMO_MODE) {
      addPacket(demoPacket('HC05_A'), 'HC-05 A');
      addPacket(demoPacket('HC05_B'), 'HC-05 B');
      setStatus(`Demo packets received at ${new Date().toLocaleTimeString()}`);
      return;
    }

    const pairedSlots = Object.keys(nodes).filter(slot => nodes[slot].port);
    if (pairedSlots.length === 0) {
      throw new Error('Pair at least one HC-05 device before starting collection.');
    }

    let collectedCount = 0;

    for (const slot of pairedSlots) {
      const node = nodes[slot];
      if (node.latestPacket) {
        const timestamp = numberFrom(node.latestPacket, ['timestamp', 'time', 't']);
        const packetKey = `${node.deviceId}:${timestamp}`;

        if (packetKey !== node.lastCollectedKey) {
          addPacket(
            { ...node.latestPacket, deviceId: node.deviceId },
            node.deviceId
          );
          node.lastCollectedKey = packetKey;
          collectedCount += 1;
        }
      }
    }

    if (collectedCount === 0) {
      setStatus('Waiting for a new valid JSON packet from the paired HC-05 port...');
      return;
    }

    setStatus(`Collected ${collectedCount} node packet(s) at ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    collecting = false;
    stopCollectionCycle();
    setStatus(error.message);
    console.error(error);
  }
}

function startCollectionCycle() {
  if (collecting) return;

  collecting = true;
  els.startCycleButton.textContent = 'Stop Collection Cycle';

  const intervalMs = Number(els.collectionInterval.value);
  setStatus(`Collecting every ${intervalMs / 1000} seconds`);

  collectOnce();
  collectionTimer = window.setInterval(collectOnce, intervalMs);
}

function stopCollectionCycle() {
  collecting = false;
  els.startCycleButton.textContent = 'Start Collection Cycle';

  if (collectionTimer) {
    window.clearInterval(collectionTimer);
    collectionTimer = null;
  }
}

function toggleCollectionCycle() {
  if (collecting) {
    stopCollectionCycle();
    setStatus('Collection stopped');
  } else {
    startCollectionCycle();
  }
}

function resetCollectionTimerIfRunning() {
  if (!collecting) return;
  stopCollectionCycle();
  startCollectionCycle();
}

function initCharts() {
  bodeChart = new Chart(document.getElementById('bodeChart'), {
    type: 'line',
    data: {
      datasets: [
        { label: '|Z| (dB)', yAxisID: 'magnitudeAxis', data: [], pointRadius: 3, borderWidth: 2 },
        { label: 'Phase (deg)', yAxisID: 'phaseAxis', data: [], pointRadius: 3, borderWidth: 2 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      scales: {
        x: { type: 'logarithmic', title: { display: true, text: 'Frequency (Hz)' } },
        magnitudeAxis: { position: 'left', title: { display: true, text: '|Z| (dB)' } },
        phaseAxis: {
          position: 'right',
          title: { display: true, text: 'Phase (deg)' },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });

  nyquistChart = new Chart(document.getElementById('nyquistChart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Nyquist', data: [], pointRadius: 4, borderWidth: 2, tension: 0.2 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Real (ohm)' } },
        y: { type: 'linear', title: { display: true, text: '-Imaginary (ohm)' } }
      }
    }
  });

  humidityChart = new Chart(document.getElementById('humidityChart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Humidity (%)', data: [], pointRadius: 3, borderWidth: 2 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Time (s)' } },
        y: { title: { display: true, text: 'Humidity (%)' } }
      }
    }
  });
}

window.addEventListener('load', () => {
  initCharts();
  setView(els.viewMode.value);
  configureDeviceCount(Number(els.deviceCount.value));

  els.themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    els.themeToggle.textContent = document.body.classList.contains('dark')
      ? 'Light Mode'
      : 'Dark Mode';
  });

  els.viewMode.addEventListener('change', event => setView(event.target.value));
  els.startCycleButton.addEventListener('click', toggleCollectionCycle);
  els.deviceCount.addEventListener('change', event => {
    configureDeviceCount(Number(event.target.value));
  });
  els.collectionInterval.addEventListener('change', resetCollectionTimerIfRunning);
  document.querySelectorAll('[data-download-csv]').forEach(button => {
    button.addEventListener('click', downloadCsv);
  });
  document.querySelectorAll('[data-import-csv]').forEach(button => {
    button.addEventListener('click', () => els.csvFileInput.click());
  });
  document.querySelectorAll('[data-clear-data]').forEach(button => {
    button.addEventListener('click', () => {
      clearAllData().catch(error => setStatus(`Data could not be cleared: ${error.message}`));
    });
  });
  els.csvFileInput.addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      await importCsv(file);
    } catch (error) {
      setStatus(`CSV import failed: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  });

  restoreStoredData().catch(error => {
    console.error(error);
    setStatus(`Stored data could not be restored: ${error.message}`);
  });

  if (DEMO_MODE) {
    setStatus('Demo mode ready');
  }
});
