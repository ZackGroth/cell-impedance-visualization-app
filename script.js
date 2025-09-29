document.addEventListener("DOMContentLoaded", () => {
  const stored = localStorage.getItem("impedanceData");
  const data = stored ? JSON.parse(stored) : null;

  if (!data || !data.real || !data.imag || (!data.frequencies && !data.time)) {
    alert("No valid impedance data found.");
    return;
  }

  const real = data.real;
  const imag = data.imag;
  const Z = real.map((r, i) => Math.sqrt(r * r + imag[i] * imag[i]));

  const frequencies = data.frequencies || new Array(real.length).fill(null);
  const times = data.time || new Array(real.length).fill(null);

  const formatLabel = (val) => {
    if (val == null) return '';
    if (val >= 1e6) return (val / 1e6).toFixed(1) + 'M';
    if (val >= 1e3) return (val / 1e3).toFixed(0) + 'k';
    return val.toFixed(0);
  };

  const freqLabels = frequencies.map(formatLabel);
  const timeLabels = times.map(t => (t == null ? '' : `${t} ms`));

  const makeChart = (canvasId, title, xLabel, labelSet) => {
    return new Chart(document.getElementById(canvasId).getContext("2d"), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Real (Ω)', data: [], borderColor: 'blue', fill: false, tension: 0.3 },
          { label: 'Imag (Ω)', data: [], borderColor: 'red', fill: false, tension: 0.3 },
          { label: '|Z| (Ω)', data: [], borderColor: 'green', fill: false, tension: 0.3 }
        ]
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          title: {
            display: true,
            text: title
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: xLabel
            }
          },
          y: {
            title: {
              display: true,
              text: 'Impedance (Ω)'
            },
            beginAtZero: false
          }
        }
      }
    });
  };

  const impedanceChart = makeChart("impedanceChart", "Impedance vs Frequency", "Frequency (Hz)", freqLabels);
  const timeChart = makeChart("timeChart", "Impedance vs Time", "Time (ms)", timeLabels);

  let index = 0;
  const interval = setInterval(() => {
    if (index >= real.length) {
      clearInterval(interval);
      return;
    }

    if (frequencies[index] != null) {
      impedanceChart.data.labels.push(formatLabel(frequencies[index]));
      impedanceChart.data.datasets[0].data.push(real[index]);
      impedanceChart.data.datasets[1].data.push(imag[index]);
      impedanceChart.data.datasets[2].data.push(Z[index]);
      impedanceChart.update();
    }

    if (times[index] != null) {
      timeChart.data.labels.push(`${times[index]} ms`);
      timeChart.data.datasets[0].data.push(real[index]);
      timeChart.data.datasets[1].data.push(imag[index]);
      timeChart.data.datasets[2].data.push(Z[index]);
      timeChart.update();
    }

    index++;
  }, 50); // Simulate new data every 500ms
});
