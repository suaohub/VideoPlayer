const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const testDirectory = process.argv[2];
app.setPath('userData', path.join(testDirectory, 'user-data'));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false, width: 1280, height: 720,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await window.loadFile(path.join(testDirectory, 'index.html'));
    window.webContents.focus();
    const results = await window.webContents.executeJavaScript(
      fs.readFileSync(path.join(__dirname, 'videoList.browser.js'), 'utf8'),
    );
    window.setSize(850, 640);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const narrow = await window.webContents.executeJavaScript(`(() => {
      const rows = [...document.querySelectorAll('.video-list-row')];
      return { count: rows.length, heights: rows.map(row => row.getBoundingClientRect().height) };
    })()`);
    if (narrow.count <= 0 || narrow.count >= 40 || narrow.heights.some((height) => height !== 78)) {
      throw new Error('Responsive layout no longer matches fixed virtual row heights');
    }
    results.push({ check: 'Narrow-window resizing preserves row geometry', mounted: narrow.count });
    fs.writeFileSync(path.join(testDirectory, 'results.json'), JSON.stringify({ success: true, results }));
    app.exit(0);
  } catch (error) {
    fs.writeFileSync(path.join(testDirectory, 'results.json'), JSON.stringify({ success: false, error: error.stack }));
    app.exit(1);
  }
}).catch((error) => {
  fs.writeFileSync(path.join(testDirectory, 'results.json'), JSON.stringify({ success: false, error: error.stack }));
  app.exit(1);
});
