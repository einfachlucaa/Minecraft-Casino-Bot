const minecraftData = require('minecraft-data');

class HealthFoodTracker {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.mcData = null;
    this.foodById = new Map();
    this.setVersion(config.version === 'auto' ? config.fallbackVersion : config.version);
    this.health = null;
    this.food = null;
    this.saturation = null;
    this.inventory = new Map();
    this.selectedHotbarSlot = 0;
    this.lastEatAttempt = 0;
    this.sequence = 0;
  }

  setVersion(version) {
    try {
      this.mcData = minecraftData(version);
      this.foodById = new Map(this.mcData.foodsArray.map((food) => [food.id, food]));
    } catch (error) {
      this.foodById = new Map();
      this.logger.log('WARN', `Minecraft-Daten fuer Version ${version} konnten nicht geladen werden: ${error.message}`);
    }
  }

  snapshot() {
    const foodItems = this.getFoodItems();
    return {
      health: this.health,
      food: this.food,
      saturation: this.saturation,
      healthText: this.health == null ? 'Unbekannt' : `${Math.ceil(this.health / 2)}/10`,
      foodText: this.food == null ? 'Unbekannt' : `${this.food}/20`,
      foodItems: foodItems.reduce((sum, item) => sum + item.count, 0),
      bestFood: foodItems[0]?.name || null,
      selectedHotbarSlot: this.selectedHotbarSlot
    };
  }

  updateHealth(packet, client) {
    this.health = packet.health;
    this.food = packet.food;
    this.saturation = packet.foodSaturation;

    if (this.health != null && this.health < this.config.autoEatHealthBelow) {
      this.logger.log('HP', `Niedrige Herzen: ${this.snapshot().healthText}`);
    }

    if (this.shouldEat()) this.tryEat(client);
  }

  updateWindowItems(packet) {
    if (packet.windowId !== 0) return;
    this.inventory.clear();
    packet.items.forEach((item, slot) => this.setSlot(slot, item));
  }

  updateSlot(packet) {
    if (packet.windowId !== 0) return;
    this.setSlot(packet.slot, packet.item);
  }

  updateSelectedSlot(packet) {
    const slot = packet.slot ?? packet.slotId;
    if (Number.isInteger(slot)) this.selectedHotbarSlot = slot;
  }

  setSlot(slot, item) {
    if (!item || !item.itemCount || item.itemCount <= 0) {
      this.inventory.delete(slot);
      return;
    }

    this.inventory.set(slot, item);
  }

  getFoodItems() {
    const result = [];
    for (const [slot, item] of this.inventory.entries()) {
      const food = this.foodById.get(item.itemId);
      if (!food) continue;
      result.push({
        slot,
        hotbarSlot: slot >= 36 && slot <= 44 ? slot - 36 : null,
        id: item.itemId,
        count: item.itemCount,
        name: food.displayName || food.name,
        foodPoints: food.foodPoints
      });
    }

    return result.sort((a, b) => {
      if (a.hotbarSlot != null && b.hotbarSlot == null) return -1;
      if (a.hotbarSlot == null && b.hotbarSlot != null) return 1;
      return b.foodPoints - a.foodPoints;
    });
  }

  shouldEat() {
    if (!this.config.autoEat) return false;
    if (this.food == null) return false;
    return this.food < this.config.autoEatFoodBelow || (this.health != null && this.health < this.config.autoEatHealthBelow);
  }

  tryEat(client) {
    const now = Date.now();
    if (now - this.lastEatAttempt < 5000) return;
    this.lastEatAttempt = now;

    const food = this.getFoodItems()[0];
    if (!food) {
      this.logger.log('FOOD', `Hunger ${this.food}/20, aber kein Essen im Inventar erkannt.`);
      return;
    }

    if (food.hotbarSlot == null) {
      this.logger.log('FOOD', `${food.name} im Inventar, aber nicht in der Hotbar. Bitte in Slot 1-9 legen.`);
      return;
    }

    try {
      client.write('held_item_slot', { slotId: food.hotbarSlot });
      client.write('use_item', {
        hand: 0,
        sequence: this.sequence++,
        rotation: { x: 0, y: 0 }
      });
      this.logger.log('FOOD', `Esse ${food.name} aus Hotbar-Slot ${food.hotbarSlot + 1}.`);
    } catch (error) {
      this.logger.log('WARN', `Auto-Essen fehlgeschlagen: ${error.message}`);
    }
  }
}

module.exports = HealthFoodTracker;