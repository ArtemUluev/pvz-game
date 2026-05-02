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
const FIELD_END_X = FIELD_START_X + COLS * CELL_W;

// Все 12 растений
const ALL_PLANTS = {
  sunflower: { name: 'Подсолнух', cost: 50, hp: 80, sunInterval: 10, cooldown: 10 },
  peashooter: { name: 'Горохострел', cost: 100, hp: 80, damage: 25, shootInterval: 1.5, cooldown: 2 },
  snowpea: { name: 'Ледяной горох', cost: 175, hp: 80, damage: 20, shootInterval: 1.7, slow: true, cooldown: 3 },
  walnut: { name: 'Орех', cost: 50, hp: 600, cooldown: 8 },
  cherrybomb: { name: 'Вишня-бомба', cost: 150, hp: 1, explosive: true, cooldown: 15 },
  // Новые 7 растений
  repeater: { name: 'Повторюха', cost: 200, hp: 80, damage: 25, shootInterval: 0.8, doubleShot: true, cooldown: 2 },
  torchwood: { name: 'Факел', cost: 175, hp: 200, fireBoost: true, cooldown: 5 },
  potatomine: { name: 'Картофель-мина', cost: 25, hp: 1, explosive: true, armTime: 8, cooldown: 12 },
  chomper: { name: 'Венерина', cost: 150, hp: 100, chompCooldown: 15, cooldown: 8 },
  starfruit: { name: 'Звездоплод', cost: 125, hp: 80, damage: 15, shootInterval: 1.2, starShots: true, cooldown: 2 },
  garlic: { name: 'Чеснок', cost: 50, hp: 200, redirect: true, cooldown: 15 },
  cattail: { name: 'Рогоз', cost: 225, hp: 80, damage: 15, shootInterval: 0.6, homing: true, cooldown: 3 }
};

// Базовые зомби (5 слотов)
const BASE_ZOMBIES = {
  basic: { name: 'Обычный', hp: 100, speed: 28, damage: 25, reward: 25, energyReward: 15, cost: 30, tier: 0 },
  cone: { name: 'Конусный', hp: 200, speed: 22, damage: 25, reward: 40, energyReward: 25, cost: 50, tier: 1 },
  bucket: { name: 'Ведёрный', hp: 400, speed: 18, damage: 35, reward: 60, energyReward: 35, cost: 80, tier: 2 },
  runner: { name: 'Бегун', hp: 80, speed: 50, damage: 15, reward: 30, energyReward: 20, cost: 40, tier: 3 },
  gargantuar: { name: 'Гаргантюа', hp: 1000, speed: 14, damage: 80, reward: 150, energyReward: 80, cost: 150, tier: 4 }
};

// Альтернативные зомби для замены
const ALT_ZOMBIES = {
  // Слот 1 (вместо basic)
  imp: { name: 'Чертёнок', hp: 60, speed: 35, damage: 10, reward: 15, energyReward: 10, cost: 20, tier: 0, replaces: 'basic' },
  triple_basic: { name: 'Трио обычных', hp: 80, speed: 25, damage: 20, reward: 20, energyReward: 12, cost: 55, tier: 0, replaces: 'basic', count: 3 },
  
  // Слот 2 (вместо cone)
  door: { name: 'Зомби с дверью', hp: 150, doorHp: 150, speed: 22, damage: 25, reward: 45, energyReward: 30, cost: 60, tier: 1, replaces: 'cone' },
  double_cone: { name: 'Два конусных', hp: 150, speed: 20, damage: 20, reward: 35, energyReward: 22, cost: 70, tier: 1, replaces: 'cone', count: 2 },
  
  // Слот 3 (вместо bucket)
  shooter: { name: 'Стрелок', hp: 150, speed: 18, damage: 10, rangedDamage: 15, shootRange: 200, reward: 70, energyReward: 40, cost: 90, tier: 2, replaces: 'bucket' },
  double_bucket: { name: 'Два ведёрных', hp: 300, speed: 16, damage: 30, reward: 50, energyReward: 30, cost: 100, tier: 2, replaces: 'bucket', count: 2 },
  
  // Слот 4 (вместо runner)
  healer: { name: 'Зомби-доктор', hp: 100, speed: 20, damage: 5, healAmount: 15, healRange: 120, reward: 40, energyReward: 25, cost: 55, tier: 3, replaces: 'runner' },
  jumper: { name: 'Прыгун', hp: 90, speed: 45, damage: 18, jumpRange: 150, reward: 35, energyReward: 22, cost: 45, tier: 3, replaces: 'runner' },
  
  // Слот 5 (вместо gargantuar)
  king: { name: 'Король зомби', hp: 800, speed: 12, damage: 60, spawnImps: true, impCount: 3, reward: 200, energyReward: 100, cost: 180, tier: 4, replaces: 'gargantuar' },
  giant: { name: 'Гигант', hp: 1200, speed: 10, damage: 100, reward: 180, energyReward: 90, cost: 160, tier: 4, replaces: 'gargantuar' }
};

// Состояние кастомизации
let player1Plants = ['sunflower', 'peashooter', 'snowpea', 'walnut', 'cherrybomb'];
let player2Plants = ['sunflower', 'peashooter', 'snowpea', 'walnut', 'cherrybomb'];
let player1Zombies = ['basic', 'cone', 'bucket', 'runner', 'gargantuar'];
let player2Zombies = ['basic', 'cone', 'bucket', 'runner', 'gargantuar'];

let gameState = {
  mode: null,
  round: 0,
  phase: 'customize', // 'customize', 'prep', 'playing', 'result', 'gameover'
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
  hordeTimer: 120,
  lastUpdate: Date.now()
};

let players = { defender: null, attacker: null, player1: null, player2: null };

// Получить статы зомби
function getZombieStats(type) {
  return BASE_ZOMBIES[type] || ALT_ZOMBIES[type] || BASE_ZOMBIES.basic;
}

// Получить статы растения
function getPlantStats(type) {
  return ALL_PLANTS[type] || ALL_PLANTS.sunflower;
}

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
  gameState.hordeTimer = 120;
  gameState.lastUpdate = Date.now();
}

function startPrepPhase() {
  gameState.phase = 'prep';
  resetRound();
}

function unlockTiers() {
  const newTier = Math.floor(gameState.zombieKillCount / 25);
  if (newTier > gameState.unlockedTiers && newTier <= 4) {
    gameState.unlockedTiers = newTier;
    io.emit('message', `🔓 Тир ${newTier + 1}/5 открыт!`);
  }
}

function getCurrentZombies() {
  return gameState.round % 2 === 0 ? player2Zombies : player1Zombies;
}

function getCurrentPlants() {
  return gameState.round % 2 === 0 ? player1Plants : player2Plants;
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

// Игровой цикл
function updateGame() {
  const now = Date.now();
  const dt = Math.min(0.2, (now - gameState.lastUpdate) / 1000);
  gameState.lastUpdate = now;
  
  if (gameState.phase === 'prep') {
    gameState.prepTimer -= dt;
    if (gameState.prepTimer <= 0) {
      gameState.phase = 'playing';
      gameState.spawnLocked = false;
    }
    return;
  }
  
  if (gameState.phase !== 'playing') return;
  
  gameState.elapsedTime += dt;
  gameState.zombieEnergy = Math.min(gameState.maxEnergy, gameState.zombieEnergy + 5 * dt);
  unlockTiers();
  
  // Авто-орда
  gameState.hordeTimer -= dt;
  if (gameState.hordeTimer <= 0 && gameState.elapsedTime >= 30) {
    spawnAutoHorde();
    gameState.hordeTimer = 90 + Math.random() * 60;
  }
  
  // Кулдауны растений
  Object.keys(gameState.plantCooldowns).forEach(key => {
    gameState.plantCooldowns[key] = Math.max(0, (gameState.plantCooldowns[key] || 0) - dt);
  });
  
  // Растения
  gameState.plants.forEach(p => {
    if (!p.alive) return;
    p.shootTimer = (p.shootTimer || 0) - dt;
    p.specialTimer = (p.specialTimer || 0) - dt;
    
    const stats = getPlantStats(p.type);
    
    if (stats.sunInterval) {
      p.sunTimer = (p.sunTimer || 0) - dt;
      if (p.sunTimer <= 0) {
        gameState.sunDrops.push({ x: p.x + (Math.random()-0.5)*40, y: p.y-10, alive: true, value: 25 });
        p.sunTimer = stats.sunInterval + Math.random() * 4;
      }
    }
    
    if (stats.shootInterval && p.shootTimer <= 0) {
      if (stats.homing) {
        // Рогоз — ищет любую цель
        const target = gameState.zombies.find(z => z.alive);
        if (target) {
          gameState.projectiles.push({
            x: p.x+20, y: p.y, row: target.row, homing: true, targetId: gameState.zombies.indexOf(target),
            damage: stats.damage, alive: true
          });
          p.shootTimer = stats.shootInterval;
        }
      } else if (stats.starShots) {
        // Звездоплод стреляет в 3 направления
        [-1, 0, 1].forEach(off => {
          const r = p.row + off;
          if (r >= 0 && r < ROWS) {
            gameState.projectiles.push({
              x: p.x+20, y: 120 + r*90 + 45, row: r,
              damage: stats.damage, alive: true
            });
          }
        });
        p.shootTimer = stats.shootInterval;
      } else {
        const hasZombie = gameState.zombies.some(z => z.row === p.row && z.alive && z.x > p.x);
        if (hasZombie) {
          gameState.projectiles.push({
            x: p.x+20, y: p.y, row: p.row,
            damage: stats.damage, fire: stats.fireBoost || false,
            slow: stats.slow || false, alive: true
          });
          p.shootTimer = stats.shootInterval;
          if (stats.doubleShot) {
            setTimeout(() => {
              if (p.alive) {
                gameState.projectiles.push({
                  x: p.x+20, y: p.y, row: p.row,
                  damage: stats.damage, fire: stats.fireBoost || false,
                  slow: stats.slow || false, alive: true
                });
              }
            }, 150);
          }
        }
      }
    }
    
    // Венерина мухоловка
    if (stats.chompCooldown && p.specialTimer <= 0) {
      const target = gameState.zombies.find(z => z.row === p.row && z.alive && Math.abs(z.x - p.x) < 45);
      if (target) {
        target.hp = 0;
        p.specialTimer = stats.chompCooldown;
      }
    }
    
    // Взрывчатка
    if (stats.explosive && p.plantTime) {
      const armTime = stats.armTime || 0.6;
      if (now - p.plantTime > armTime * 1000) {
        gameState.zombies.forEach(z => {
          if (!z.alive) return;
          if (Math.hypot(z.x-p.x, z.y-p.y) < 160) z.hp -= 180;
        });
        p.alive = false;
      }
    }
    
    if (p.hp <= 0) p.alive = false;
  });
  
  // Зомби
  gameState.zombies.forEach((z, zi) => {
    if (!z.alive) return;
    
    // Стрелок
    if (z.rangedDamage) {
      z.shootTimer = (z.shootTimer || 0) - dt;
      if (z.shootTimer <= 0 && z.x < FIELD_END_X) {
        const target = gameState.plants.find(p => p.alive && p.row === z.row && Math.abs(p.x - z.x) < z.shootRange);
        if (target) {
          target.hp -= z.rangedDamage;
          z.shootTimer = 2;
        }
      }
    }
    
    // Доктор лечит
    if (z.healAmount) {
      z.healTimer = (z.healTimer || 0) - dt;
      if (z.healTimer <= 0) {
        gameState.zombies.forEach(zz => {
          if (zz.alive && zz !== z && Math.hypot(zz.x-z.x, zz.y-z.y) < z.healRange) {
            zz.hp = Math.min(zz.maxHp, zz.hp + z.healAmount);
          }
        });
        z.healTimer = 3;
      }
    }
    
    // Прыгун
    if (z.jumpRange && !z.jumped) {
      const target = gameState.plants.find(p => p.alive && p.row === z.row && z.x - p.x < z.jumpRange && z.x - p.x > 40);
      if (target) {
        z.x = target.x - 20;
        z.jumped = true;
      }
    }
    
    let blocking = gameState.plants.find(p => p.alive && p.row === z.row && Math.abs(z.x - p.x) < 45);
    
    if (blocking) {
      z.attackTimer = (z.attackTimer || 0) - dt;
      if (z.attackTimer <= 0) {
        if (z.doorHp && z.doorHp > 0) {
          z.doorHp -= blocking.type === 'walnut' ? 50 : 25;
          if (z.doorHp <= 0) z.doorHp = 0;
        } else {
          blocking.hp -= z.damage;
          if (blocking.type === 'garlic') {
            // Чеснок перенаправляет зомби
            z.row = (z.row + 1) % ROWS;
            z.y = FIELD_TOP_Y + z.row * CELL_H + CELL_H/2;
          }
        }
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
    
    if (z.x < FIELD_START_X && gameState.lawnmowers[z.row]) {
      gameState.lawnmowers[z.row] = false;
      gameState.zombies.forEach(zz => { if (zz.row === z.row) zz.alive = false; });
    }
    
    if (z.x < FIELD_START_X - 60 && !gameState.lawnmowers[z.row]) {
      z.alive = false;
      gameState.score2++;
      if (gameState.score2 >= 5) endRound('attacker');
    }
    
    if (z.hp <= 0) {
      z.alive = false;
      gameState.score1++;
      gameState.zombieKillCount++;
      gameState.sunPoints += z.reward || 25;
      gameState.zombieEnergy = Math.min(gameState.maxEnergy, gameState.zombieEnergy + (z.energyReward || 15));
      
      // Король зомби спавнит чертят
      if (z.spawnImps && z.impCount > 0) {
        for (let i = 0; i < z.impCount; i++) {
          gameState.zombies.push({
            type: 'imp', row: z.row,
            x: z.x + Math.random()*40, y: z.y + (Math.random()-0.5)*30,
            hp: 60, maxHp: 60, speed: 35, damage: 10, reward: 15,
            energyReward: 10, alive: true, slowed: false
          });
        }
      }
    }
  });
  
  // Снаряды
  gameState.projectiles.forEach(p => {
    if (!p.alive) return;
    
    if (p.homing && gameState.zombies[p.targetId]?.alive) {
      const t = gameState.zombies[p.targetId];
      const dx = t.x - p.x, dy = t.y - p.y, dist = Math.hypot(dx, dy);
      p.x += (dx/dist) * 400 * dt;
      p.y += (dy/dist) * 400 * dt;
    } else {
      p.x += 400 * dt;
    }
    
    gameState.zombies.forEach(z => {
      if (!z.alive || (!p.homing && z.row !== p.row)) return;
      if (Math.abs(p.x - z.x) < 22) {
        if (z.doorHp && z.doorHp > 0) {
          z.doorHp -= p.damage;
          if (z.doorHp <= 0) z.doorHp = 0;
        } else {
          z.hp -= p.damage;
        }
        if (p.fire) z.hp -= 10;
        if (p.slow) z.slowed = true;
        p.alive = false;
      }
    });
    
    if (p.x > FIELD_END_X + 300 || p.x < 0) p.alive = false;
  });
  
  if (Math.random() < dt * 0.1) {
    gameState.sunDrops.push({ x: FIELD_START_X + Math.random()*COLS*CELL_W, y: 90, alive: true, value: 25 });
  }
  
  gameState.plants = gameState.plants.filter(p => p.alive);
  gameState.zombies = gameState.zombies.filter(z => z.alive);
  gameState.projectiles = gameState.projectiles.filter(p => p.alive);
  gameState.sunDrops = gameState.sunDrops.filter(s => s.alive);
}

function spawnAutoHorde() {
  const count = Math.min(5 + Math.floor(gameState.elapsedTime / 20), 20);
  const currentZombies = getCurrentZombies();
  const availableTypes = currentZombies.filter(t => {
    const stats = getZombieStats(t);
    return stats.tier <= gameState.unlockedTiers;
  });
  
  for (let i = 0; i < count; i++) {
    const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
    const stats = getZombieStats(type);
    const count = stats.count || 1;
    for (let j = 0; j < count; j++) {
      const row = Math.floor(Math.random() * ROWS);
      gameState.zombies.push({
        type, row,
        x: FIELD_END_X + Math.random()*20,
        y: FIELD_TOP_Y + row*CELL_H + CELL_H/2,
        hp: stats.hp, maxHp: stats.hp, speed: stats.speed,
        damage: stats.damage, reward: stats.reward || 25,
        energyReward: stats.energyReward || 15,
        doorHp: stats.doorHp || 0,
        rangedDamage: stats.rangedDamage || 0,
        shootRange: stats.shootRange || 0,
        healAmount: stats.healAmount || 0,
        healRange: stats.healRange || 0,
        jumpRange: stats.jumpRange || 0,
        spawnImps: stats.spawnImps || false,
        impCount: stats.impCount || 0,
        alive: true, slowed: false
      });
    }
  }
}

function broadcastState() {
  const state = {
    mode: gameState.mode,
    round: gameState.round,
    phase: gameState.phase,
    plants: gameState.plants.filter(p => p.alive).map(p => ({ type: p.type, row: p.row, col: p.col, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp })),
    zombies: gameState.zombies.filter(z => z.alive).map(z => ({ type: z.type, row: z.row, x: z.x, y: z.y, hp: z.hp, maxHp: z.maxHp, slowed: z.slowed, doorHp: z.doorHp || 0 })),
    projectiles: gameState.projectiles.filter(p => p.alive).map(p => ({ x: p.x, y: p.y, row: p.row, fire: p.fire || false, homing: p.homing || false })),
    sunDrops: gameState.sunDrops.filter(s => s.alive).map((s,i) => ({ id: i, x: s.x, y: s.y, value: s.value })),
    lawnmowers: gameState.lawnmowers,
    sunPoints: Math.floor(gameState.sunPoints),
    zombieEnergy: Math.floor(gameState.zombieEnergy),
    spawnLocked: gameState.spawnLocked,
    prepTimer: Math.ceil(gameState.prepTimer),
    elapsedTime: gameState.elapsedTime,
    unlockedTiers: gameState.unlockedTiers,
    zombieKillCount: gameState.zombieKillCount,
    plantCooldowns: gameState.plantCooldowns,
    score1: gameState.score1,
    score2: gameState.score2,
    roundsWon: gameState.roundsWon,
    gameOver: gameState.gameOver,
    winner: gameState.winner,
    hordeTimer: Math.ceil(gameState.hordeTimer),
    player1Plants,
    player2Plants,
    player1Zombies,
    player2Zombies
  };
  io.emit('state', state);
}

setInterval(() => {
  if (gameState.phase !== 'lobby' && gameState.phase !== 'customize') updateGame();
  broadcastState();
}, 1000/30);

// Подключение
io.on('connection', (socket) => {
  if (!players.player1) {
    players.player1 = socket.id;
    players.defender = socket.id;
    socket.emit('role', 'defender');
    socket.emit('isHost', true);
  } else if (!players.player2) {
    players.player2 = socket.id;
    players.attacker = socket.id;
    socket.emit('role', 'attacker');
  } else {
    socket.emit('error', 'Игра заполнена');
    socket.disconnect();
    return;
  }
  
  socket.on('selectMode', (mode) => {
    if (socket.id !== players.player1 || gameState.phase !== 'lobby') return;
    gameState.mode = mode;
    gameState.phase = 'customize';
    io.emit('message', 'Настройте свои войска!');
  });
  
  socket.on('setPlants', (plants) => {
    if (socket.id === players.player1) player1Plants = plants.slice(0, 5);
    if (socket.id === players.player2) player2Plants = plants.slice(0, 5);
  });
  
  socket.on('setZombies', (zombies) => {
    if (socket.id === players.player1) player1Zombies = zombies.slice(0, 5);
    if (socket.id === players.player2) player2Zombies = zombies.slice(0, 5);
  });
  
  socket.on('startGame', () => {
    if (gameState.phase !== 'customize') return;
    gameState.round = 0;
    startPrepPhase();
    io.emit('message', 'Игра начинается! 15 секунд подготовки.');
  });
  
  socket.on('plant', (data) => {
    if (socket.id !== players.defender || gameState.phase !== 'playing') return;
    const currentPlants = getCurrentPlants();
    if (!currentPlants.includes(data.type)) return;
    const stats = getPlantStats(data.type);
    if (gameState.sunPoints < stats.cost) return;
    if ((gameState.plantCooldowns[data.type] || 0) > 0) return;
    if (data.row < 0 || data.row >= ROWS || data.col < 0 || data.col >= COLS) return;
    if (gameState.plants.some(p => p.alive && p.row === data.row && p.col === data.col)) return;
    
    gameState.sunPoints -= stats.cost;
    gameState.plantCooldowns[data.type] = stats.cooldown || 3;
    
    gameState.plants.push({
      type: data.type, row: data.row, col: data.col,
      x: FIELD_START_X + data.col*CELL_W + CELL_W/2,
      y: FIELD_TOP_Y + data.row*CELL_H + CELL_H/2,
      hp: stats.hp, maxHp: stats.hp,
      shootTimer: 0, sunTimer: 0, specialTimer: 0,
      plantTime: Date.now(), alive: true
    });
  });
  
  socket.on('collect', (data) => {
    if (socket.id !== players.defender) return;
    const sun = gameState.sunDrops[data.id];
    if (sun?.alive) { gameState.sunPoints += sun.value; sun.alive = false; }
  });
  
  socket.on('zombie', (data) => {
    if (socket.id !== players.attacker || gameState.phase !== 'playing' || gameState.spawnLocked) return;
    const currentZombies = getCurrentZombies();
    if (!currentZombies.includes(data.type)) return;
    const stats = getZombieStats(data.type);
    if (stats.tier > gameState.unlockedTiers) return;
    const cost = stats.cost || 30;
    if (gameState.zombieEnergy < cost) return;
    const row = data.row !== undefined ? data.row : Math.floor(Math.random()*ROWS);
    if (row < 0 || row >= ROWS) return;
    
    gameState.zombieEnergy -= cost;
    const cnt = stats.count || 1;
    for (let i = 0; i < cnt; i++) {
      gameState.zombies.push({
        type: data.type, row,
        x: FIELD_END_X + i*20,
        y: FIELD_TOP_Y + row*CELL_H + CELL_H/2,
        hp: stats.hp, maxHp: stats.hp, speed: stats.speed,
        damage: stats.damage, reward: stats.reward || 25,
        energyReward: stats.energyReward || 15,
        doorHp: stats.doorHp || 0,
        rangedDamage: stats.rangedDamage || 0,
        shootRange: stats.shootRange || 0,
        healAmount: stats.healAmount || 0,
        healRange: stats.healRange || 0,
        jumpRange: stats.jumpRange || 0,
        spawnImps: stats.spawnImps || false,
        impCount: stats.impCount || 0,
        alive: true, slowed: false
      });
    }
  });
  
  socket.on('nextRound', () => {
    if (gameState.mode !== 'versus' || gameState.phase !== 'result' || gameState.round >= 3) return;
    gameState.round++;
    switchSides();
    startPrepPhase();
  });
  
  socket.on('restart', () => {
    gameState = {
      mode: null, round: 0, phase: 'lobby',
      plants: [], zombies: [], projectiles: [], sunDrops: [],
      lawnmowers: Array(ROWS).fill(true),
      sunPoints: 150, zombieEnergy: 60, maxEnergy: 300,
      prepTimer: 15, gameTimer: 0, elapsedTime: 0,
      spawnLocked: true, unlockedTiers: 0, zombieKillCount: 0,
      plantCooldowns: {}, score1: 0, score2: 0,
      roundsWon: [0,0], matchScores: [],
      gameOver: false, winner: null, hordeTimer: 120, lastUpdate: Date.now()
    };
    players.defender = players.player1;
    players.attacker = players.player2;
    if (players.player1) io.to(players.player1).emit('role', 'defender');
    if (players.player2) io.to(players.player2).emit('role', 'attacker');
  });
  
  socket.on('disconnect', () => {
    if (socket.id === players.player1) players.player1 = null;
    if (socket.id === players.player2) players.player2 = null;
    if (socket.id === players.defender) players.defender = null;
    if (socket.id === players.attacker) players.attacker = null;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🎮 Сервер v4.0 на порту ' + PORT));
