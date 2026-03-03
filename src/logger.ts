import log from 'electron-log/main';
import { MAX_LOG_FILE_SIZE } from './js/libs/constants';

// Configure file logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.transports.file.maxSize = MAX_LOG_FILE_SIZE;

// Initialize for main process
log.initialize();

export default log;
