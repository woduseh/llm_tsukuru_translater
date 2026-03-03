"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const main_1 = __importDefault(require("electron-log/main"));
// Configure file logging
main_1.default.transports.file.level = 'info';
main_1.default.transports.console.level = 'debug';
main_1.default.transports.file.maxSize = 5 * 1024 * 1024; // 5MB
// Initialize for main process
main_1.default.initialize();
exports.default = main_1.default;
