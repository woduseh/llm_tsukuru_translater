import log from 'electron-log/main';

// Configure file logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB

// Initialize for main process
log.initialize();

export default log;
