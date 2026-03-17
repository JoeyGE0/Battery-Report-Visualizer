// DOM Elements
const fileInput = document.getElementById('fileInput');
const uploadZone = document.getElementById('uploadZone');
const report = document.getElementById('report');
const resetBtn = document.getElementById('resetBtn');

// Chart instances
let voltageChart = null;
let resistanceChart = null;
let tempChart = null;

// Colors for charts - matches the battery calculator theme
const chartColorsColor = {
    voltage: '#667eea',      // Primary purple-blue
    resistance: '#ed8936',   // Orange
    mosTemp: '#f56565',      // Warning red
    cpuTemp: '#f6ad55',      // Amber
    ntcTemp: '#48bb78',      // Success green
    grid: 'rgba(255, 255, 255, 0.1)',
    gridPrint: '#cccccc',    // Darker grid for print
    text: '#a0aec0'
};

// B&W colors for print-friendly charts - darker for better contrast
const chartColorsBW = {
    voltage: '#000000',      // Black (solid)
    resistance: '#000000',   // Black (solid) - same as voltage
    mosTemp: '#000000',      // Black (solid)
    cpuTemp: '#666666',      // Dark grey (dashed)
    ntcTemp: '#999999',      // Medium grey (dotted)
    grid: 'rgba(255, 255, 255, 0.1)',
    gridPrint: '#cccccc',
    text: '#a0aec0'
};

// Get chart colors based on B&W print mode
function getChartColors() {
    const bwPrintChecked = document.getElementById('bwPrint')?.checked || false;
    return bwPrintChecked ? chartColorsBW : chartColorsColor;
}

// Get grid color - darker for print visibility
function getGridColor() {
    // Use darker grid that will show up in print
    return '#cccccc';
}

// Chart.js default config
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif";
Chart.defaults.color = chartColorsColor.text;

// Click to upload
uploadZone.addEventListener('click', () => fileInput.click());

// Drag and drop
uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
        processFile(file);
    } else {
        alert('Please drop a CSV file');
    }
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        processFile(file);
    }
});

// Process CSV file
function processFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const csv = e.target.result;
        const data = parseCSV(csv);
        if (data && data.length > 0) {
            updateReport(data);
            uploadZone.style.display = 'none';
            resetBtn.style.display = 'inline-block';
        }
    };
    reader.readAsText(file);
}

// Parse ATORCH CSV format
function parseCSV(csv) {
    const lines = csv.trim().split('\n');
    
    // Skip first 3 header lines, line 4 is column headers
    // Data starts from line 5 (index 4)
    const data = [];
    
    for (let i = 4; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const cols = line.split(',');
        if (cols.length < 11) continue;
        
        // Parse the data
        const row = {
            timestamp: cols[0],
            voltage: parseFloat(cols[1]),
            current: Math.abs(parseFloat(cols[2])), // Current is negative in CSV
            power: parseFloat(cols[3]),
            resistance: parseFloat(cols[4]),
            energy: parseFloat(cols[5]),
            capacity: parseFloat(cols[6]), // in mAh
            ntcTemp: parseFloat(cols[7]),
            cpuTemp: parseFloat(cols[8]),
            mosTemp: parseFloat(cols[9]),
            fanSpeed: parseInt(cols[10])
        };
        
        // Skip invalid rows
        if (isNaN(row.voltage) || isNaN(row.current)) continue;
        
        data.push(row);
    }
    
    // Find the first voltage reading where current is 0 or near 0 (not under load)
    // This is the true start voltage at full charge
    const NO_LOAD_THRESHOLD = 0.1; // Current below 0.1A means no load
    let trueStartVoltage = null;
    for (let i = 0; i < data.length; i++) {
        if (data[i].current < NO_LOAD_THRESHOLD && data[i].voltage > 0) {
            trueStartVoltage = data[i].voltage;
            break;
        }
    }
    
    // Skip first 10 measurements (~10 seconds) to let values stabilize
    // This avoids inaccurate readings during ramp-up period
    const STABILIZATION_SKIP = 10;
    const validStartData = data.slice(STABILIZATION_SKIP);
    
    // Detect when test has stopped - find FIRST point where current drops below 1A
    // When current drops below 1A, the test has finished (before it restarts with 0.000000 and 9999.991)
    // Remove ALL data from that point onwards - it should not be used in any calculations or graphs
    const STOP_THRESHOLD = 1.0; // Current below 1A means test ended
    let stopIndex = validStartData.length;
    
    // Work forwards to find the first point where current drops below threshold
    // Skip first few readings (ramp-up period) to avoid false positives
    for (let i = 5; i < validStartData.length; i++) {
        if (validStartData[i].current < STOP_THRESHOLD) {
            // Found where current dropped - test ended here, remove everything from this point
            stopIndex = i;
            break;
        }
    }
    
    // Find the last voltage reading where current is 0 or near 0 (after test ends)
    // This is the true end voltage when load is removed
    let trueEndVoltage = null;
    // Search backwards from the end of all raw data to find last no-load reading
    // This looks for readings after the test has ended (when load is removed)
    for (let i = data.length - 1; i >= 0; i--) {
        if (data[i].current < NO_LOAD_THRESHOLD && data[i].voltage > 0) {
            // Make sure this is after the test started (not the initial start reading)
            if (i > STABILIZATION_SKIP + 5) {
                trueEndVoltage = data[i].voltage;
                break;
            }
        }
    }
    // If not found, use the last valid data point
    if (trueEndVoltage === null && stopIndex > 0) {
        trueEndVoltage = validStartData[stopIndex - 1].voltage;
    }
    
    // Return the valid data AND the true start/end voltages
    const validData = validStartData.slice(0, stopIndex);
    validData.trueStartVoltage = trueStartVoltage; // Attach as property
    validData.trueEndVoltage = trueEndVoltage; // Attach as property
    return validData;
}

// Parse timestamp to Date object
function parseTimestamp(ts) {
    // Format: 2025-12-22_20:22:20
    const [date, time] = ts.split('_');
    return new Date(`${date}T${time}`);
}

// Get temperature class for MOS/CPU (can handle more heat)
function getMosCpuTempClass(temp) {
    if (temp < 60) return 'cool';
    if (temp < 85) return 'warm';
    return 'hot';
}

// Get temperature class for NTC/Battery (more sensitive)
function getBatteryTempClass(temp) {
    if (temp < 35) return 'cool';
    if (temp < 45) return 'warm';
    return 'hot';
}

// Format duration
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

// Update report with parsed data
function updateReport(data) {
    const first = data[0];
    const last = data[data.length - 1];
    
    // Calculate stats
    const startTime = parseTimestamp(first.timestamp);
    const endTime = parseTimestamp(last.timestamp);
    const duration = endTime - startTime;
    
    // Use true start voltage (when current was 0) if available, otherwise use first data point
    const startVoltage = data.trueStartVoltage || first.voltage;
    // Use true end voltage (when current was 0) if available, otherwise use last data point
    const endVoltage = data.trueEndVoltage || last.voltage;
    
    // Energy and capacity are cumulative in the CSV
    const totalEnergy = last.energy - first.energy;
    const totalCapacity = (last.capacity - first.capacity) / 1000; // mAh to Ah
    
    // Calculate averages (skip first few readings as they ramp up)
    const stableData = data.slice(5);
    const avgCurrent = stableData.reduce((sum, d) => sum + d.current, 0) / stableData.length;
    const avgPower = stableData.reduce((sum, d) => sum + d.power, 0) / stableData.length;
    
    // Peak temps
    const peakMosTemp = Math.max(...data.map(d => d.mosTemp));
    const peakCpuTemp = Math.max(...data.map(d => d.cpuTemp));
    
    // Update DOM
    document.getElementById('testDate').textContent = first.timestamp.split('_')[0];
    document.getElementById('testDuration').textContent = `Duration: ${formatDuration(duration)}`;
    
    // Calculate voltage drop percentage for color coding
    const voltageDrop = ((startVoltage - endVoltage) / startVoltage) * 100;
    
    // Start voltage - always good (charged state)
    const startVoltageEl = document.getElementById('startVoltage');
    startVoltageEl.innerHTML = `${startVoltage.toFixed(2)}<span class="stat-unit">V</span>`;
    startVoltageEl.className = 'stat-value good';
    
    // End voltage - color based on how much it dropped
    const endVoltageEl = document.getElementById('endVoltage');
    endVoltageEl.innerHTML = `${endVoltage.toFixed(2)}<span class="stat-unit">V</span>`;
    if (voltageDrop < 5) {
        endVoltageEl.className = 'stat-value good';
    } else if (voltageDrop < 15) {
        endVoltageEl.className = 'stat-value okay';
    } else if (voltageDrop < 25) {
        endVoltageEl.className = 'stat-value warn';
    } else {
        endVoltageEl.className = 'stat-value bad';
    }
    
    // Energy and capacity - neutral
    document.getElementById('totalEnergy').innerHTML = `${totalEnergy.toFixed(2)}<span class="stat-unit">Wh</span>`;
    document.getElementById('totalCapacity').innerHTML = `${totalCapacity.toFixed(3)}<span class="stat-unit">Ah</span>`;
    
    // Current and power - neutral
    document.getElementById('avgCurrent').innerHTML = `${avgCurrent.toFixed(2)}<span class="stat-unit">A</span>`;
    document.getElementById('avgPower').innerHTML = `${avgPower.toFixed(1)}<span class="stat-unit">W</span>`;
    
    // Peak NTC/Battery temp - most important, batteries are sensitive
    const peakNtcTemp = Math.max(...data.map(d => d.ntcTemp));
    const peakNtcTempEl = document.getElementById('peakNtcTemp');
    peakNtcTempEl.innerHTML = `${peakNtcTemp.toFixed(1)}<span class="stat-unit">°C</span>`;
    peakNtcTempEl.className = 'stat-value ' + getBatteryTempClass(peakNtcTemp);
    
    // Peak MOS temp - can handle more heat
    const peakMosTempEl = document.getElementById('peakMosTemp');
    peakMosTempEl.innerHTML = `${peakMosTemp.toFixed(1)}<span class="stat-unit">°C</span>`;
    peakMosTempEl.className = 'stat-value ' + getMosCpuTempClass(peakMosTemp);
    
    // Peak CPU temp
    const peakCpuTempEl = document.getElementById('peakCpuTemp');
    peakCpuTempEl.innerHTML = `${peakCpuTemp.toFixed(1)}<span class="stat-unit">°C</span>`;
    peakCpuTempEl.className = 'stat-value ' + getMosCpuTempClass(peakCpuTemp);
    
    // Average resistance (skip first few unstable readings)
    const avgResistance = stableData.reduce((sum, d) => sum + d.resistance, 0) / stableData.length;
    document.getElementById('avgResistance').innerHTML = `${avgResistance.toFixed(2)}<span class="stat-unit">Ω</span>`;
    
    // Hide placeholders
    document.getElementById('voltagePlaceholder').style.display = 'none';
    document.getElementById('resistancePlaceholder').style.display = 'none';
    document.getElementById('tempPlaceholder').style.display = 'none';
    
    // Update header with custom settings
    updateReportHeader();
    
    // Store data for re-rendering
    currentData = data;
    
    // Render charts
    renderVoltageChart(data);
    renderResistanceChart(data);
    renderTempChart(data);
}

// Update report header with custom settings
function updateReportHeader() {
    const businessName = document.getElementById('businessName').value.trim();
    const serialNumber = document.getElementById('serialNumber').value.trim();
    const clientName = document.getElementById('clientName').value.trim();
    const vehicleInfo = document.getElementById('vehicleInfo').value.trim();
    const notes = document.getElementById('notes').value.trim();
    
    // Update title if business name provided
    if (businessName) {
        document.getElementById('reportTitle').textContent = businessName;
    } else {
        document.getElementById('reportTitle').textContent = 'Battery Report';
    }
    
    // Update logo
    const brandLogo = document.getElementById('brandLogo');
    const brandIcon = document.getElementById('brandIcon');
    if (currentLogoData) {
        brandLogo.src = currentLogoData;
        brandLogo.style.display = 'block';
        brandIcon.style.display = 'none';
    } else {
        brandLogo.style.display = 'none';
        brandIcon.style.display = 'flex';
    }
    
    // Update serial/reference
    if (serialNumber) {
        document.getElementById('reportSerial').textContent = serialNumber;
    }
    
    // Update info bar
    const infoBar = document.getElementById('infoBar');
    const infoClient = document.getElementById('infoClient');
    const infoVehicle = document.getElementById('infoVehicle');
    const infoNotes = document.getElementById('infoNotes');
    
    infoClient.textContent = clientName ? `Client: ${clientName}` : '';
    infoVehicle.textContent = vehicleInfo || '';
    infoNotes.textContent = notes || '';
    
    // Show info bar if any info provided
    if (clientName || vehicleInfo || notes) {
        infoBar.style.display = 'flex';
    } else {
        infoBar.style.display = 'none';
    }
}

// Render voltage vs capacity chart
function renderVoltageChart(data) {
    const ctx = document.getElementById('voltageChart').getContext('2d');
    const colors = getChartColors();
    
    // Calculate capacity in Ah relative to start
    const startCapacity = data[0].capacity;
    const chartData = data.map(d => ({
        x: (d.capacity - startCapacity) / 1000, // mAh to Ah
        y: d.voltage
    }));
    
    if (voltageChart) voltageChart.destroy();
    
    voltageChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Voltage',
                data: chartData,
                borderColor: colors.voltage,
                borderWidth: 2.5,
                pointRadius: 0,
                tension: 0.1,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.5,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Capacity (Ah)',
                        color: colors.text
                    },
                    grid: {
                        color: getGridColor(),
                        lineWidth: 1
                    },
                    ticks: {
                        color: colors.text
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Voltage (V)',
                        color: colors.text
                    },
                    grid: {
                        color: getGridColor(),
                        lineWidth: 1
                    },
                    ticks: {
                        color: colors.text
                    }
                }
            }
        }
    });
}

// Render resistance vs capacity chart
function renderResistanceChart(data) {
    const ctx = document.getElementById('resistanceChart').getContext('2d');
    const colors = getChartColors();
    
    // Calculate capacity in Ah relative to start - use ALL data from CSV
    const startCapacity = data[0].capacity;
    
    // Use all data directly from CSV - no filtering
    const chartData = data.map(d => ({
        x: (d.capacity - startCapacity) / 1000, // mAh to Ah
        y: d.resistance
    }));
    
    // Calculate Y-axis range from actual data
    const resistances = chartData.map(d => d.y).filter(r => !isNaN(r) && r > 0);
    if (resistances.length === 0) return;
    
    const minRes = Math.min(...resistances);
    const maxRes = Math.max(...resistances);
    const padding = (maxRes - minRes) * 0.1; // 10% padding
    
    if (resistanceChart) resistanceChart.destroy();
    
    resistanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Resistance',
                data: chartData,
                borderColor: colors.resistance,
                borderWidth: 2.5,
                pointRadius: 0,
                tension: 0.1,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.5,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Capacity (Ah)',
                        color: colors.text
                    },
                    grid: {
                        color: getGridColor(),
                        lineWidth: 1
                    },
                    ticks: {
                        color: colors.text
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Resistance (Ω)',
                        color: colors.text
                    },
                    min: Math.max(0, minRes - padding),
                    max: maxRes + padding,
                    grid: {
                        color: getGridColor(),
                        lineWidth: 1
                    },
                    ticks: {
                        color: colors.text
                    }
                }
            }
        }
    });
}

// Render temperature vs time chart
function renderTempChart(data) {
    const ctx = document.getElementById('tempChart').getContext('2d');
    const colors = getChartColors();
    
    // Calculate time in seconds from start
    const startTime = parseTimestamp(data[0].timestamp);
    const chartData = data.map(d => {
        const time = parseTimestamp(d.timestamp);
        return {
            x: (time - startTime) / 1000, // seconds
            mosTemp: d.mosTemp,
            cpuTemp: d.cpuTemp,
            ntcTemp: d.ntcTemp
        };
    });
    
    // Calculate max time and add padding
    const maxTime = Math.max(...chartData.map(d => d.x));
    const timePadding = maxTime * 0.05; // 5% padding
    
    if (tempChart) tempChart.destroy();
    
    tempChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'MOS',
                    data: chartData.map(d => ({ x: d.x, y: d.mosTemp })),
                    borderColor: colors.mosTemp,
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointStyle: 'circle',
                    hitRadius: 10,
                    tension: 0.1,
                    fill: false
                },
                {
                    label: 'CPU',
                    data: chartData.map(d => ({ x: d.x, y: d.cpuTemp })),
                    borderColor: colors.cpuTemp,
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointStyle: 'circle',
                    hitRadius: 10,
                    tension: 0.1,
                    fill: false
                },
                {
                    label: 'NTC',
                    data: chartData.map(d => ({ x: d.x, y: d.ntcTemp })),
                    borderColor: colors.ntcTemp,
                    borderWidth: 2,
                    borderDash: [2, 2],
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointStyle: 'circle',
                    hitRadius: 10,
                    tension: 0.1,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.5,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {},
                    usePointStyle: true,
                    boxPadding: 6
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: false,
                        boxWidth: 25,
                        boxHeight: 2,
                        color: colors.text,
                        padding: 15,
                        font: {
                            family: 'monospace',
                            size: 11
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Time (seconds)',
                        color: colors.text
                    },
                    min: 0,
                    max: maxTime + timePadding,
                    grid: {
                        color: getGridColor(),
                        lineWidth: 1
                    },
                    ticks: {
                        color: colors.text
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Temperature (°C)',
                        color: colors.text
                    },
                    grid: {
                        color: getGridColor(),
                        lineWidth: 1
                    },
                    ticks: {
                        color: colors.text
                    }
                }
            }
        }
    });
}

// Update document title for print filename
function updateDocumentTitle() {
    const parts = ['Battery Report'];
    
    const serialNumber = document.getElementById('serialNumber').value.trim();
    const clientName = document.getElementById('clientName').value.trim();
    const testDate = document.getElementById('testDate').textContent;
    
    if (clientName) parts.push(clientName);
    if (testDate && testDate !== '--') parts.push(testDate);
    if (serialNumber) parts.push(serialNumber);
    
    document.title = parts.join(' - ');
    
    // Set author meta tag
    let authorMeta = document.querySelector('meta[name="author"]');
    if (!authorMeta) {
        authorMeta = document.createElement('meta');
        authorMeta.name = 'author';
        document.head.appendChild(authorMeta);
    }
    authorMeta.content = 'Joey Rides';
}

// Print functionality
function printReport() {
    // Set print date
    const now = new Date();
    document.getElementById('printDate').textContent = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    // Update filename
    updateDocumentTitle();
    
    window.print();
}

// Store parsed data for re-rendering charts
let currentData = null;

// Store logo data
let currentLogoData = null;

// Load saved settings from localStorage
function loadSavedSettings() {
    const savedBusinessName = localStorage.getItem('batteryReport_businessName');
    const savedLogoData = localStorage.getItem('batteryReport_logoData');
    
    if (savedBusinessName) {
        document.getElementById('businessName').value = savedBusinessName;
    }
    if (savedLogoData) {
        currentLogoData = savedLogoData;
        document.getElementById('logoUploadBtn').textContent = 'Logo Set ✓';
        document.getElementById('logoUploadBtn').classList.add('has-logo');
        document.getElementById('logoClearBtn').style.display = 'block';
    }
    
    // Update report header with saved values
    updateReportHeader();
}

// Save business settings to localStorage
function saveBusinessSettings() {
    const businessName = document.getElementById('businessName').value.trim();
    
    localStorage.setItem('batteryReport_businessName', businessName);
    if (currentLogoData) {
        localStorage.setItem('batteryReport_logoData', currentLogoData);
    } else {
        localStorage.removeItem('batteryReport_logoData');
    }
}

// Settings event listeners
document.getElementById('businessName').addEventListener('input', () => {
    updateReportHeader();
    saveBusinessSettings();
});

// Logo upload handling
document.getElementById('logoUploadBtn').addEventListener('click', () => {
    document.getElementById('logoUpload').click();
});

document.getElementById('logoUpload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            currentLogoData = event.target.result;
            document.getElementById('logoUploadBtn').textContent = 'Logo Set ✓';
            document.getElementById('logoUploadBtn').classList.add('has-logo');
            document.getElementById('logoClearBtn').style.display = 'block';
            updateReportHeader();
            saveBusinessSettings();
        };
        reader.readAsDataURL(file);
    }
});

document.getElementById('logoClearBtn').addEventListener('click', () => {
    currentLogoData = null;
    document.getElementById('logoUpload').value = '';
    document.getElementById('logoUploadBtn').textContent = 'Choose Image';
    document.getElementById('logoUploadBtn').classList.remove('has-logo');
    document.getElementById('logoClearBtn').style.display = 'none';
    updateReportHeader();
    saveBusinessSettings();
});

document.getElementById('serialNumber').addEventListener('input', updateReportHeader);
document.getElementById('clientName').addEventListener('input', updateReportHeader);
document.getElementById('vehicleInfo').addEventListener('input', updateReportHeader);
document.getElementById('notes').addEventListener('input', updateReportHeader);

// B&W toggle - adds class to body for CSS print styles
document.getElementById('bwPrint').addEventListener('change', (e) => {
    if (e.target.checked) {
        document.body.classList.add('bw-print');
    } else {
        document.body.classList.remove('bw-print');
    }
    // Re-render all charts with new colors
    if (currentData) {
        renderVoltageChart(currentData);
        renderResistanceChart(currentData);
        renderTempChart(currentData);
    }
});

// Load saved settings on page load
loadSavedSettings();

// Reset to upload new file
function resetReport() {
    uploadZone.style.display = 'block';
    resetBtn.style.display = 'none';
    fileInput.value = '';
    
    // Reset stats and classes
    document.getElementById('testDate').textContent = '--';
    document.getElementById('testDuration').textContent = 'Duration: --';
    
    const startVoltageEl = document.getElementById('startVoltage');
    startVoltageEl.innerHTML = '--<span class="stat-unit">V</span>';
    startVoltageEl.className = 'stat-value';
    
    const endVoltageEl = document.getElementById('endVoltage');
    endVoltageEl.innerHTML = '--<span class="stat-unit">V</span>';
    endVoltageEl.className = 'stat-value';
    
    document.getElementById('totalEnergy').innerHTML = '--<span class="stat-unit">Wh</span>';
    document.getElementById('totalCapacity').innerHTML = '--<span class="stat-unit">Ah</span>';
    document.getElementById('avgCurrent').innerHTML = '--<span class="stat-unit">A</span>';
    document.getElementById('avgPower').innerHTML = '--<span class="stat-unit">W</span>';
    
    const peakNtcTempEl = document.getElementById('peakNtcTemp');
    peakNtcTempEl.innerHTML = '--<span class="stat-unit">°C</span>';
    peakNtcTempEl.className = 'stat-value';
    
    const peakMosTempEl = document.getElementById('peakMosTemp');
    peakMosTempEl.innerHTML = '--<span class="stat-unit">°C</span>';
    peakMosTempEl.className = 'stat-value';
    
    const peakCpuTempEl = document.getElementById('peakCpuTemp');
    peakCpuTempEl.innerHTML = '--<span class="stat-unit">°C</span>';
    peakCpuTempEl.className = 'stat-value';
    
    document.getElementById('avgResistance').innerHTML = '--<span class="stat-unit">Ω</span>';
    
    // Reset header
    document.getElementById('reportTitle').textContent = 'Battery Report';
    document.getElementById('reportSerial').textContent = '--';
    document.getElementById('infoBar').style.display = 'none';
    
    // Show placeholders
    document.getElementById('voltagePlaceholder').style.display = 'flex';
    document.getElementById('resistancePlaceholder').style.display = 'flex';
    document.getElementById('tempPlaceholder').style.display = 'flex';
    
    // Destroy charts
    if (voltageChart) {
        voltageChart.destroy();
        voltageChart = null;
    }
    if (resistanceChart) {
        resistanceChart.destroy();
        resistanceChart = null;
    }
    if (tempChart) {
        tempChart.destroy();
        tempChart = null;
    }
}
