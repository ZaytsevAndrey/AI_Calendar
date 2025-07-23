const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const dirsToClean = [
  path.join(rootDir, 'node_modules'),
  path.join(rootDir, 'frontend', 'node_modules'),
  path.join(rootDir, 'frontend', 'build'),
  path.join(rootDir, 'backend', 'node_modules'),
  path.join(rootDir, 'backend', 'dist'),
];

console.log('Cleaning project...');

dirsToClean.forEach(dir => {
  if (fs.existsSync(dir)) {
    console.log(`Removing ${path.relative(rootDir, dir)}`);
    
    try {
      if (process.platform === 'win32') {
        execSync(`rmdir /s /q "${dir}"`, { stdio: 'inherit' });
      } else {
        execSync(`rm -rf "${dir}"`, { stdio: 'inherit' });
      }
    } catch (error) {
      console.error(`Failed to remove ${dir}:`, error.message);
    }
  }
});

console.log('Cleaning complete!'); 