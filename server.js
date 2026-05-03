const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

// ─────────────────── КОНСТАНТЫ ───────────────────
const ROWS = 5;
const COLS = 9;
const FIELD_START_X = 150;
const CELL_W = 85;
const CELL_H = 90;
const FIELD_TOP_Y = 120;
const FIELD_END_X = FIELD_START_X + COLS * CELL_W; // 915
const ZOMBIE_SPAWN_X = FIELD_END_X; // Зомби появляются прямо на правом краю поля

const PLANT_COSTS = {
  sunflower: 50, peashooter: 100, repeater: 200, walnut: 50, snowpea: 175, cherrybomb: 150, mine: 25
};
const PLANT_HP = {
  sunflower: 80, peashooter: 80, repeater: 80, walnut: 600, snowpea: 80, cherrybomb: 1, mine: 50
};
const PLANT_COOLDOWNS = {
  sunflower: 10, peashooter: 2, repeater: 1.2, walnut: 8, snowpea: 3, cherrybomb: 15, mine: 20
};

// Зомби с уровнями открытия
const ZOMBIE_TIERS = {
  basic: { tier: 0, hp: 100, speed: 28, damage: 25, reward: 25, energyReward: 15, name: 'Обычный' },
  cone: { tier: 1, hp: 200, speed: 22, damage: 25, reward: 40, energyReward: 25, name: 'Конусный' },
  bucket: { tier: 2, hp: 400, speed: 18, damage: 35, reward: 60, energyReward: 35, name: 'Ведёрный' },
  runner: { tier: 3, hp: 80, speed: 50, damage: 15, reward: 30, energyReward: 20, name: 'Бегун' },
  gargantuar: { tier: 4, hp: 1000, speed: 14, damage: 1000, reward: 150, energyReward: 80, name: 'Гаргантюа' }
};

const ZOMBIE_ENERGY_COSTS = {
  basic: 30, cone: 50, bucket: 80, runner: 40, gargantuar: 150
};

// ─────────────────── СОСТОЯНИЕ ИГРЫ ───────────────────
let gameState = {
  mode: null,
  round: 0,
  phase: 'lobby',
  rolesAssigned: false,
  plants: [],
  zombies: [],
  projectiles: [],
  sunDrops: [],
  lawnmowers: [],
  sunPoints: 150,
  zombieEnergy: 60,
  maxEnergy: 300,
  prepTimer: 15,
  gameTimer: 0,
  elapsedTime: 0,
  spawnLocked: true,
  unlockedTiers: 0,
  zombieKillCount: 0,
  plantCooldowns: {},
  score1: 0,
  score2: 0,
  roundsWon: [0, 0],
  matchScores: [],
  gameOver: false,
  winner: null,
  lastUpdate: Date.now()
};

let players = { defender: null, attacker: null, player1: null, player2: null };

// ─────────────────── ФУНКЦИИ ───────────────────
function resetRound() {
  gameState.plants = [];
  gameState.zombies = [];
  gameState.projectiles = [];
  gameState.sunDrops = [];
  gameState.lawnmowers = Array(ROWS).fill(true);
  gameState.sunPoints = 150;
  gameState.zombieEnergy = 60;
  gameState.maxEnergy = 300;
  gameState.prepTimer = 15;
  gameState.gameTimer = 0;
  gameState.elapsedTime = 0;
  gameState.spawnLocked = true;
  gameState.unlockedTiers = 0;
  gameState.zombieKillCount = 0;
  gameState.plantCooldowns = {};
  gameState.gameOver = false;
  gameState.winner = null;
  gameState.score1 = 0;
  gameState.score2 = 0;
  gameState.lastUpdate = Date.now();
}

function startPrepPhase() {
  gameState.phase = 'prep';
  resetRound();
}

function startPlayingPhase() {
  gameState.phase = 'playing';
  gameState.spawnLocked = false;
  gameState.lastUpdate = Date.now();
}

function unlockTiers() {
  const newTier = Math.floor(gameState.zombieKillCount / 25);
  if (newTier > gameState.unlockedTiers && newTier <= 4) {
    gameState.unlockedTiers = newTier;
    const unlockedList = Object.keys(ZOMBIE_TIERS).filter(t => ZOMBIE_TIERS[t].tier <= gameState.unlockedTiers);
    io.emit('message', `🔓 Открыты новые зомби! Тир ${gameState.unlockedTiers + 1}/5`);
    io.emit('unlockedZombies', unlockedList);
  }
}

function getHordeComposition() {
  const count = Math.min(10 + Math.floor(gameState.elapsedTime / 30) * 3, 30);
  const types = [];
  const availableTypes = Object.keys(ZOMBIE_TIERS).filter(t => ZOMBIE_TIERS[t].tier <= gameState.unlockedTiers);
  
  for (let i = 0; i < count; i++) {
    const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
    types.push(type);
  }
  return types;
}

function endRound(winner) {
  gameState.phase = 'result';
  gameState.gameOver = true;
  gameState.winner = winner;
  
  gameState.matchScores.push({
    round: gameState.round,
    timeSurvived: gameState.elapsedTime,
    score1: gameState.score1,
    score2: gameState.score2,
    winner: winner
  });
  
  if (gameState.mode === 'versus' && gameState.round >= 3) {
    gameState.phase = 'gameover';
  }
}

function switchSides() {
  const temp = players.defender;
  players.defender = players.attacker;
  players.attacker = temp;
  
  if (players.defender) {
    io.to(players.defender).emit('role', 'defender');
    io.to(players.defender).emit('message', 'Теперь вы Защитник!');
  }
  if (players.attacker) {
    io.to(players.attacker).emit('role', 'attacker');
    io.to(players.attacker).emit('message', 'Теперь вы Атакующий!');
  }
}

// ─────────────────── ИГРОВОЙ ЦИКЛ ───────────────────
function updateGame() {
  const now = Date.now();
  const dt = Math.min(0.2, (now - gameState.lastUpdate) / 1000);
  gameState.lastUpdate = now;
  
  if (gameState.phase === 'prep') {
    gameState.prepTimer -= dt;
    if (gameState.prepTimer <= 0) {
      startPlayingPhase();
    }
    return;
  }
  
  if (gameState.phase !== 'playing') return;
  
  // Таймер идёт вверх
  gameState.elapsedTime += dt;
  gameState.gameTimer = gameState.elapsedTime;
  
  // Регенерация энергии (5 в секунду)
  gameState.zombieEnergy = Math.min(gameState.maxEnergy, gameState.zombieEnergy + 5 * dt);
  
  // Открытие тиров
  unlockTiers();
  
  // Обновление кулдаунов растений
  Object.keys(gameState.plantCooldowns).forEach(key => {
    gameState.plantCooldowns[key] = Math.max(0, (gameState.plantCooldowns[key] || 0) - dt);
  });
  
  // Растения
  gameState.plants.forEach(p => {
    if (!p.alive) return;
    p.shootTimer = (p.shootTimer || 0) - dt;
    
    if (p.type === 'sunflower') {
      p.sunTimer = (p.sunTimer || 0) - dt;
      if (p.sunTimer <= 0) {
        gameState.sunDrops.push({
          x: p.x + (Math.random() - 0.5) * 40,
          y: p.y - 10,
          alive: true,
          value: 25
        });
        p.sunTimer = 8 + Math.random() * 4;
      }
    }
    
    if ((p.type === 'peashooter' || p.type === 'repeater' || p.type === 'snowpea') && p.shootTimer <= 0) {
      const hasZombie = gameState.zombies.some(z =>
        z.row === p.row && z.alive && z.x > p.x && z.x < FIELD_END_X + 150
      );
      if (hasZombie) {
        const damage = p.type === 'snowpea' ? 20 : 15;
        const slow = p.type === 'snowpea';
        const shootTimer = p.type === 'repeater' ? 1.8 : 1.2; // repeater shoots 2 peas
        if (p.type === 'repeater') {
          gameState.projectiles.push({
            x: p.x + 20, y: p.y - 5, row: p.row,
            damage, slow, alive: true
          });
          gameState.projectiles.push({
            x: p.x + 20, y: p.y + 5, row: p.row,
            damage, slow, alive: true
          });
        } else {
          gameState.projectiles.push({
            x: p.x + 20, y: p.y, row: p.row,
            damage, slow, alive: true
          });
        }
        p.shootTimer = shootTimer;
      }
    }
    
    // Мина
    if (p.type === 'mine') {
      gameState.zombies.forEach(z => {
        if (!z.alive || z.row !== p.row) return;
        if (Math.abs(z.x - p.x) < 60) {
          z.hp -= 300;
          p.alive = false;
        }
      });
    }
    
    if (p.type === 'cherrybomb' && p.plantTime && now - p.plantTime > 600) {
      gameState.zombies.forEach(z => {
        if (!z.alive) return;
        if (Math.hypot(z.x - p.x, z.y - p.y) < 150) {
          z.hp -= 180;
        }
      });
      p.alive = false;
    }
  });
  
  // Зомби
  gameState.zombies.forEach(z => {
    if (!z.alive) return;
    
    // Decay slow timer
    z.slowTimer = Math.max(0, (z.slowTimer || 0) - dt);
    z.slowed = z.slowTimer > 0;
    
    let blocking = gameState.plants.find(p =>
      p.alive && p.row === z.row && Math.abs(z.x - p.x) < 45
    );
    
    if (blocking) {
      z.attackTimer = (z.attackTimer || 0) - dt;
      if (z.attackTimer <= 0) {
        blocking.hp -= z.damage;
        z.attackTimer = 0.7;
        if (blocking.hp <= 0) {
          blocking.alive = false;
          gameState.zombieEnergy = Math.min(gameState.maxEnergy, gameState.zombieEnergy + 20);
        }
      }
    } else {
      const speed = z.slowed ? z.speed * 0.4 : z.speed;
      z.x -= speed * dt;
    }
    
    // Газонокосилка
    if (z.x < FIELD_START_X && gameState.lawnmowers[z.row]) {
      gameState.lawnmowers[z.row] = false;
      gameState.zombies.forEach(zz => {
        if (zz.row === z.row && zz.alive) zz.alive = false;
      });
    }
    
    // Зомби дошёл до дома
    if (z.x < FIELD_START_X - 60 && !gameState.lawnmowers[z.row]) {
      z.alive = false;
      gameState.score2++;
      if (gameState.score2 >= 5) endRound('attacker');
    }
    
    if (z.hp <= 0) {
      z.alive = false;
      gameState.score1++;
      gameState.zombieKillCount++;
      gameState.sunPoints += z.reward;
      gameState.zombieEnergy = Math.min(gameState.maxEnergy, gameState.zombieEnergy + z.energyReward);
    }
  });
  
  // Снаряды
  gameState.projectiles.forEach(p => {
    if (!p.alive) return;
    p.x += 400 * dt;
    
    gameState.zombies.forEach(z => {
      if (!z.alive || z.row !== p.row) return;
      if (Math.abs(p.x - z.x) < 22) {
        z.hp -= p.damage;
        if (p.slow) z.slowTimer = 3.0;
        p.alive = false;
      }
    });
    
    if (p.x > FIELD_END_X + 200) p.alive = false;
  });
  
  // Случайное солнце
  if (Math.random() < dt * 0.1) {
    gameState.sunDrops.push({
      x: FIELD_START_X + Math.random() * (COLS * CELL_W),
      y: 90,
      alive: true,
      value: 25
    });
  }
  
  // Очистка
  gameState.plants = gameState.plants.filter(p => p.alive);
  gameState.zombies = gameState.zombies.filter(z => z.alive);
  gameState.projectiles = gameState.projectiles.filter(p => p.alive);
  gameState.sunDrops = gameState.sunDrops.filter(s => s.alive);
}

// ─────────────────── ОТПРАВКА СОСТОЯНИЯ ───────────────────
function broadcastState() {
  const state = {
    mode: gameState.mode,
    round: gameState.round,
    phase: gameState.phase,
    plants: gameState.plants.filter(p => p.alive).map(p => ({
      type: p.type, row: p.row, col: p.col, x: p.x, y: p.y,
      hp: p.hp, maxHp: p.maxHp
    })),
    zombies: gameState.zombies.filter(z => z.alive).map(z => ({
      type: z.type, row: z.row, x: z.x, y: z.y,
      hp: z.hp, maxHp: z.maxHp, slowed: z.slowTimer > 0
    })),
    projectiles: gameState.projectiles.filter(p => p.alive).map(p => ({
      x: p.x, y: p.y, row: p.row, slow: p.slow
    })),
    sunDrops: gameState.sunDrops.filter(s => s.alive).map((s, i) => ({
      id: i, x: s.x, y: s.y, value: s.value
    })),
    lawnmowers: gameState.lawnmowers,
    sunPoints: Math.floor(gameState.sunPoints),
    zombieEnergy: Math.floor(gameState.zombieEnergy),
    maxEnergy: gameState.maxEnergy,
    spawnLocked: gameState.spawnLocked,
    prepTimer: Math.ceil(gameState.prepTimer),
    gameTimer: Math.ceil(gameState.gameTimer),
    elapsedTime: gameState.elapsedTime,
    unlockedTiers: gameState.unlockedTiers,
    zombieKillCount: gameState.zombieKillCount,
    plantCooldowns: gameState.plantCooldowns,
    score1: gameState.score1,
    score2: gameState.score2,
    roundsWon: gameState.roundsWon,
    matchScores: gameState.matchScores,
    gameOver: gameState.gameOver,
    winner: gameState.winner
  };
  
  io.emit('state', state);
}

setInterval(() => {
  if (gameState.phase !== 'lobby') {
    updateGame();
  }
  broadcastState();
}, 1000 / 30);

// ─────────────────── ПОДКЛЮЧЕНИЕ ИГРОКОВ ───────────────────
io.on('connection', (socket) => {
  console.log('Подключился:', socket.id);
  
  if (!players.player1) {
    players.player1 = socket.id;
    socket.emit('isHost', true);
  } else if (!players.player2) {
    players.player2 = socket.id;
  }
  
  // Check if both players connected, show role select
  if (players.player1 && !gameState.rolesAssigned) {
    gameState.phase = 'role_select';
    io.to(players.player1).emit('showRoleSelect');
    io.emit('message', 'Хост выбери роли! (можно одному)');
  }
  
  socket.on('chooseRole', (choice) => {
    if (socket.id !== players.player1 || gameState.phase !== 'role_select') return;
    
    gameState.rolesAssigned = true;
    gameState.phase = 'waiting_mode';
    
    if (choice === 'me_defend') {
      players.defender = players.player1;
      players.attacker = players.player2 || null; // OK без второго
    } else {
      players.defender = players.player2 || players.player1;
      players.attacker = players.player1;
    }
    
    io.to(players.defender).emit('role', 'defender');
    io.to(players.attacker).emit('role', 'attacker');
    io.emit('message', 'Роли назначены! Хост выбери режим.');
    io.to(players.player1).emit('showModeSelect');
  });
  
  socket.on('selectMode', (mode) => {
    if (socket.id !== players.player1 || gameState.phase !== 'waiting_mode') return;
    gameState.mode = mode;
    gameState.phase = 'prep';
    resetRound();
    io.emit('message', `Режим: Бесконечный бой. Подготовка 15с!`);
    startPrepPhase();
  });
  
  socket.on('plant', (data) => {
    if (socket.id !== players.defender || gameState.phase !== 'playing') return;
    if (gameState.sunPoints < PLANT_COSTS[data.type]) return;
    if (data.row < 0 || data.row >= ROWS || data.col < 0 || data.col >= COLS) return;
    if (gameState.plants.some(p => p.alive && p.row === data.row && p.col === data.col)) return;
    
    const cooldownKey = data.type;
    if ((gameState.plantCooldowns[cooldownKey] || 0) > 0) return;
    
    gameState.sunPoints -= PLANT_COSTS[data.type];
    gameState.plantCooldowns[cooldownKey] = PLANT_COOLDOWNS[data.type];
    
    gameState.plants.push({
      type: data.type, row: data.row, col: data.col,
      x: FIELD_START_X + data.col * CELL_W + CELL_W / 2,
      y: FIELD_TOP_Y + data.row * CELL_H + CELL_H / 2,
      hp: PLANT_HP[data.type], maxHp: PLANT_HP[data.type],
      shootTimer: 0, sunTimer: 0,
      plantTime: Date.now(),
      alive: true
    });
  });
  
  socket.on('collect', (data) => {
    if (socket.id !== players.defender) return;
    const sun = gameState.sunDrops[data.id];
    if (sun && sun.alive) {
      gameState.sunPoints += sun.value;
      sun.alive = false;
    }
  });
  
  socket.on('zombie', (data) => {
    if (socket.id !== players.attacker || gameState.phase !== 'playing' || gameState.spawnLocked) return;
    
    const tier = ZOMBIE_TIERS[data.type]?.tier;
    if (tier === undefined || tier > gameState.unlockedTiers) return;
    if (gameState.zombieEnergy < ZOMBIE_ENERGY_COSTS[data.type]) return;
    
    const row = data.row !== undefined ? data.row : Math.floor(Math.random() * ROWS);
    if (row < 0 || row >= ROWS) return;
    
    gameState.zombieEnergy -= ZOMBIE_ENERGY_COSTS[data.type];
    const s = ZOMBIE_TIERS[data.type];
    gameState.zombies.push({
      type: data.type, row: row,
      x: ZOMBIE_SPAWN_X,
      y: FIELD_TOP_Y + row * CELL_H + CELL_H / 2,
      hp: s.hp, maxHp: s.hp, speed: s.speed,
      damage: s.damage, reward: s.reward,
      energyReward: s.energyReward,
      attackTimer: 0.3, slowTimer: 0, slowed: false, alive: true
    });
  });
  
  socket.on('horde', () => {
    if (socket.id !== players.attacker || gameState.phase !== 'playing' || gameState.spawnLocked) return;
    if (gameState.elapsedTime < 90) return;
    
    const types = getHordeComposition();
    types.forEach(type => {
      if (gameState.zombieEnergy < ZOMBIE_ENERGY_COSTS[type]) return;
      gameState.zombieEnergy -= ZOMBIE_ENERGY_COSTS[type];
      const s = ZOMBIE_TIERS[type];
      const row = Math.floor(Math.random() * ROWS);
      gameState.zombies.push({
        type, row: row,
        x: ZOMBIE_SPAWN_X,
        y: FIELD_TOP_Y + row * CELL_H + CELL_H / 2,
        hp: s.hp, maxHp: s.hp, speed: s.speed,
        damage: s.damage, reward: s.reward,
        energyReward: s.energyReward,
        attackTimer: 0.2, slowed: false, alive: true
      });
    });
  });
  
  socket.on('nextRound', () => {
    if (gameState.mode !== 'versus' || gameState.phase !== 'result') return;
    gameState.round++;
    if (gameState.round >= 4) {
      gameState.phase = 'gameover';
      io.emit('message', `Матч окончен! Счёт: ${gameState.roundsWon[0]} - ${gameState.roundsWon[1]}`);
    } else {
      switchSides();
      startPrepPhase();
      io.emit('message', `Раунд ${gameState.round + 1}/4`);
    }
  });
  
  socket.on('restart', () => {
    gameState = {
      mode: null,
      round: 0,
      phase: 'lobby',
      rolesAssigned: false,
      plants: [],
      zombies: [],
      projectiles: [],
      sunDrops: [],
      lawnmowers: Array(ROWS).fill(true),
      sunPoints: 150,
      zombieEnergy: 60,
      maxEnergy: 300,
      prepTimer: 15,
      gameTimer: 0,
      elapsedTime: 0,
      spawnLocked: true,
      unlockedTiers: 0,
      zombieKillCount: 0,
      plantCooldowns: {},
      score1: 0,
      score2: 0,
      roundsWon: [0, 0],
      matchScores: [],
      gameOver: false,
      winner: null,
      lastUpdate: Date.now()
    };
    players.defender = null;
    players.attacker = null;
    if (players.player1) {
      io.to(players.player1).emit('isHost', true);
      io.to(players.player1).emit('role', null);
    }
    if (players.player2) {
      io.to(players.player2).emit('role', null);
    }
    io.emit('message', 'Игра перезапущена. Ждём игроков.');
  });
  
  socket.on('disconnect', () => {
    if (socket.id === players.player1) players.player1 = null;
    if (socket.id === players.player2) players.player2 = null;
    if (socket.id === players.defender) players.defender = null;
    if (socket.id === players.attacker) players.attacker = null;
    gameState.phase = 'lobby';
    gameState.rolesAssigned = false;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🎮 Сервер на порту ' + PORT));
