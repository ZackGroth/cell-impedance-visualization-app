/**
 * realtime.js
 * Handles Bluetooth communication with the ESP32 device.
 * Parses incoming impedance data, updates the Bode and Nyquist plots in real-time,
 * and manages the live data table.
 */
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

let bodeChart, nyquistChart;
let tableBody = document.querySelector('#liveDataTable tbody');
let collecting = true;
let impedanceData = [];
let nyquistData = [];

document.getElementById('toggleCollectButton').addEventListener('click', () => {
  collecting = !collecting;
  document.getElementById('toggleCollectButton').textContent =
    collecting ? '⏸️ Pause Collection' : '▶️ Start Collection';
});

document.getElementById('bleConnectButton').addEventListener('click', async () => {
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }]
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', handleNotification);
  } catch (error) {
    console.error('BLE connection failed:', error);
  }
});

function handleNotification(event) {
  if (!collecting) return;
  const value = new TextDecoder().decode(event.target.value);
  try {
    const data = JSON.parse(value);
    updateTable(data);
    processData(data);
    updateCharts();
  } catch (e) {
    console.warn('Bad BLE packet:', value);
  }
}

function processData(data) {
  const freq = data.freq;
  const real = data.real;
  const imag = data.imag;
  const zMag = Math.sqrt(real ** 2 + imag ** 2);
  const zDb = 20 * Math.log10(zMag);
  const phase = Math.atan2(imag, real) * (180 / Math.PI);
  const time = (data.timestamp / 1000).toFixed(2);

  impedanceData.push({ x: freq, zDb, phase });
  impedanceData.sort((a, b) => a.x - b.x);

  nyquistData.push({ real, imag, freq });  // store freq for sorting
  if (nyquistData.length > 100) nyquistData.shift();
}

function updateCharts() {
  bodeChart.data.datasets[0].data = impedanceData.map(p => ({ x: p.x, y: p.zDb }));
  bodeChart.data.datasets[1].data = impedanceData.map(p => ({ x: p.x, y: p.phase }));

  // Sort Nyquist data by frequency before plotting
  const sortedNyquist = [...nyquistData].sort((a, b) => a.freq - b.freq);
  nyquistChart.data.datasets[0].data = sortedNyquist.map(p => ({
    x: p.real,
    y: -p.imag  // Flip for conventional Nyquist plot
  }));

  bodeChart.update();
  nyquistChart.update();
}

function updateTable(data) {
  const zMag = Math.sqrt(data.real ** 2 + data.imag ** 2);
  const row = `
    <tr>
      <td>${(data.timestamp / 1000).toFixed(2)}</td>
      <td>${data.freq}</td>
      <td>${data.real.toFixed(2)}</td>
      <td>${data.imag.toFixed(2)}</td>
      <td>${zMag.toFixed(2)}</td>
    </tr>
  `;
  tableBody.insertAdjacentHTML('beforeend', row);
  if (tableBody.children.length > 50) {
    tableBody.removeChild(tableBody.children[0]);
  }
  document.querySelector('.table-scroll').scrollTop = tableBody.scrollHeight;
}

window.onload = () => {
  bodeChart = new Chart(document.getElementById('bodeChart').getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        {
          label: '|Z| (dB)',
          yAxisID: 'y1',
          borderColor: 'blue',
          backgroundColor: 'blue',
          pointRadius: 3,
          fill: false,
          data: []
        },
        {
          label: 'Phase (°)',
          yAxisID: 'y2',
          borderColor: 'red',
          backgroundColor: 'red',
          pointRadius: 3,
          fill: false,
          data: []
        }
      ]
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: {
          type: 'logarithmic',
          title: { display: true, text: 'Frequency (Hz)' }
        },
        y1: {
          position: 'left',
          title: { display: true, text: '|Z| (dB)' }
        },
        y2: {
          position: 'right',
          title: { display: true, text: 'Phase (°)' },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });

  nyquistChart = new Chart(document.getElementById('nyquistChart').getContext('2d'), {
    type: 'line',
    data: {
      datasets: [{
        label: 'Nyquist Plot',
        borderColor: 'green',
        backgroundColor: 'green',
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
        tension: 0.3,
        fill: false,
        showLine: true,
        data: []
      }]
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Real (Ω)' }
        },
        y: {
          type: 'linear',
          title: { display: true, text: 'Imag (Ω)' },
          reverse: true // flip the y-axis for conventional Nyquist layout
        }
      }
    }
  });
};
