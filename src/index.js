const config = require('./config');
const logger = require('./ui/logger');
const CasinoService = require('./casino/CasinoService');
const MinecraftBot = require('./core/MinecraftBot');
const ConsoleController = require('./console/ConsoleController');

logger.printBanner(config);

const casino = new CasinoService(config, logger);
const bot = new MinecraftBot(config, casino, logger);
const consoleController = new ConsoleController(config, bot, casino, logger);

process.on('uncaughtException', (error) => {
  logger.log('ERROR', `Unbehandelte Ausnahme: ${error.message}`);
  if (/framing|ERR_OUT_OF_RANGE|readVarInt|Splitter/i.test(error.stack || error.message)) {
    logger.log('WARN', 'Protocol-Stream wurde zurueckgesetzt. Starte Reconnect statt Prozess-Abbruch.');
    bot.reconnect();
    return;
  }

  consoleController.stop();
});

bot.start();
consoleController.start();