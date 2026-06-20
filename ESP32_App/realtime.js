/**
 * realtime.js
 * Handles the web app controls, BLE packet parsing, impedance calculations,
 * chart updates, and live tables.
 */

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const DEMO_MODE = false;
const DATABASE_NAME = 'sensor-monitor-esp32';
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
const databasePromise = openPacketDatabase().catch(error => {
  console.warn('Persistent browser storage is unavailable:', error);
  return null;
});

const nodes = {
  A: { label: 'ESP32-A', device: null },
  B: { label: 'ESP32-B', device: null }
};

const els = {
  themeToggle: document.getElementById('themeToggle'),
  startCycleButton: document.getElementById('startCycleButton'),
  pairNodeAButton: document.getElementById('pairNodeAButton'),
  pairNodeBButton: document.getElementById('pairNodeBButton'),
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

function normalizeImpedancePacket(data, fallbackDeviceId = 'ESP32') {
  const timestamp = numberFrom(data, ['timestamp', 'time', 't']);
  const frequency = numberFrom(data, ['frequency', 'freq', 'frequencyHz']);
  const real = numberFrom(data, ['real', 'realImpedance', 'real impedance']);
  const imag = numberFrom(data, ['imag', 'imaginary', 'imaginaryImpedance', 'imaginary impedance']);
  const deviceId = stringFrom(data, ['deviceId', 'deviceID', 'id'], fallbackDeviceId);

  if (timestamp === null || frequency === null || real === null || imag === null) {
    return null;
  }

  const magnitude = Math.sqrt((real ** 2) + (imag ** 2));
  const phase = Math.atan2(imag, real) * (180 / Math.PI);
  const magnitudeDb = 20 * Math.log10(magnitude);

  return {
    timestamp,
    timeSec: timestamp > 1000000000 ? timestamp : timestamp / 1000,
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

  const timestamp = numberFrom(data, ['timestamp', 'time', 't']) ?? Date.now();

  return {
    timestamp,
    timeSec: timestamp > 1000000000 ? timestamp / 1000 : timestamp / 1000,
    deviceId: stringFrom(data, ['deviceId', 'deviceID', 'id'], fallbackDeviceId),
    humidity
  };
}

function formatTime(timestamp) {
  if (timestamp > 1000000000) {
    return new Date(timestamp).toLocaleTimeString();
  }
  return `${(timestamp / 1000).toFixed(2)} s`;
}

function trimRows(rows, maxRows = 200) {
  while (rows.length > maxRows) rows.shift();
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
    return [
      {
        label: `${deviceId} |Z| (dB)`,
        yAxisID: 'magnitudeAxis',
        data: rows.map(row => ({ x: row.frequency, y: row.magnitudeDb })),
        pointRadius: 3,
        borderWidth: 2
      },
      {
        label: `${deviceId} Phase (deg)`,
        yAxisID: 'phaseAxis',
        data: rows.map(row => ({ x: row.frequency, y: row.phase })),
        pointRadius: 3,
        borderWidth: 2,
        borderDash: [5, 4]
      }
    ];
  });
  bodeChart.update('none');

  nyquistChart.data.datasets = deviceIds.map(deviceId => {
    const rows = sortedByFrequency.filter(row => row.deviceId === deviceId);
    return {
      label: deviceId,
      data: rows.map(row => ({ x: row.real, y: -row.imag })),
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
    return {
      label: `${deviceId} humidity (%)`,
      data: rows.map(row => ({ x: row.timeSec, y: row.humidity })),
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
      <td>${row.deviceId}</td>
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
      <td>${row.deviceId}</td>
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
      <td>${row.deviceId}</td>
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

async function pairNode(slot) {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is not available in this browser.');
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }]
  });

  nodes[slot].device = device;
  const button = slot === 'A' ? els.pairNodeAButton : els.pairNodeBButton;
  button.textContent = `${nodes[slot].label} Paired`;
  button.classList.add('paired');
  setStatus(`${nodes[slot].label} paired: ${device.name || device.id}`);
}

async function readNodePacket(slot) {
  const node = nodes[slot];
  if (!node.device) return null;

  setStatus(`Connecting to ${node.label}...`);
  const server = await node.device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
  const value = await characteristic.readValue();
  const text = new TextDecoder().decode(value);
  node.device.gatt.disconnect();

  return {
    fallbackDeviceId: node.label,
    packet: JSON.parse(text)
  };
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
      addPacket(demoPacket('ESP32-A'), 'ESP32-A');
      addPacket(demoPacket('ESP32-B'), 'ESP32-B');
      setStatus(`Demo packets received at ${new Date().toLocaleTimeString()}`);
      return;
    }

    const pairedSlots = Object.keys(nodes).filter(slot => nodes[slot].device);
    if (pairedSlots.length === 0) {
      throw new Error('Pair ESP32-A or ESP32-B before starting collection.');
    }

    for (const slot of pairedSlots) {
      const result = await readNodePacket(slot);
      if (result) addPacket(result.packet, result.fallbackDeviceId);
    }

    setStatus(`Last packet received at ${new Date().toLocaleTimeString()}`);
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

  els.themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    els.themeToggle.textContent = document.body.classList.contains('dark')
      ? 'Light Mode'
      : 'Dark Mode';
  });

  els.viewMode.addEventListener('change', event => setView(event.target.value));
  els.startCycleButton.addEventListener('click', toggleCollectionCycle);
  els.pairNodeAButton.addEventListener('click', () => pairNode('A').catch(error => setStatus(error.message)));
  els.pairNodeBButton.addEventListener('click', () => pairNode('B').catch(error => setStatus(error.message)));
  els.collectionInterval.addEventListener('change', resetCollectionTimerIfRunning);
  document.querySelectorAll('[data-download-csv]').forEach(button => {
    button.addEventListener('click', downloadCsv);
  });
  document.querySelectorAll('[data-import-csv]').forEach(button => {
    button.addEventListener('click', () => els.csvFileInput.click());
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
