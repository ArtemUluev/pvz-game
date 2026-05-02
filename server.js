const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static('public'));

// ─────────────────── КОНСТАНТЫ ───────────────────
const ROWS = 5;
const COLS = 9;
const FIELD_START_X = 150;
const CELL_W = 85;
const CELL_H = 90;
const FIELD_TOP_Y = 120;
const ZOMBIE_SPAWN_X = 1050;

const PLANT_COSTS = {
  sunflower: 50, peashooter: 100, walnut: 50, snowpea: 175, cherrybomb: 150
};
const PLANT_HP = {
  sunflower: 80, peashooter: 80, walnut: 600, snowpea: 80, cherrybomb: 1
};
const ZOMBIE_COSTS = {
  basic: 40, cone: 70, bucket: 110
};
const ZOMBIE_STATS = {
  basic: { hp: 100, speed: 22, damage: 25, reward: 25 },
  cone: { hp: 200, speed: 18, damage: 25, reward: 40 },
  bucket: { hp: 400, speed: 14, damage: 35, reward: 60 }
};

// ─────────────────── СОСТОЯНИЕ ИГРЫ ───────────────────
let gameState = {
  mode: null,           // 'endless' или 'versus'
  round: 0,             // 0-3 в versus (0: p1-защита, 1: p2-защита, 2: p1-защита, 3: p2-защита)
  phase: 'lobby',       // 'lobby', 'prep', 'playing', 'result', 'gameover'
  plants: [],
  zombies: [],
  projectiles: [],
  sunDrops: [],
  lawnmowers: [],       // [row] = true/false
  sunPoints: 300,
  zombieEnergy: 80,
  prepTimer: 15,        // 15 секунд подготовки
  gameTimer: 120,       // 2 минуты на раунд
  spawnLocked: true,    // спавн зомби заблокирован первые 15 сек
  score1: 0,
  score2: 0,
  roundsWon: [0, 0],    // [player1, player2] для versus
  matchScores: [],       // [{defender, attacker}] для endless
  gameOver: false,
  winner: null,
  lastUpdate: Date.now()
};

let players = {
  defender: null,    // socket.id текущего защитника
  attacker: null,    // socket.id текущего атакующего
  player1: null,     // первый подключившийся
  player2: null      // второй подключившийся
};

// ─────────────────── ФУНКЦИИ ───────────────────
function resetRound() {
  gameState.plants = [];
  gameState.zombies = [];
  gameState.projectiles = [];
  gameState.sunDrops = [];
  gameState.lawnmowers = Array(ROWS).fill(true);
  gameState.sunPoints = 300;
  gameState.zombieEnergy = 80;
  gameState.prepTimer = 15;
  gameState.spawnLocked = true;
  gameState.gameOver = false;
  gameState.winner = null;
  gameState.lastUpdate = Date.now();
  
  if (gameState.mode === 'endless') {
    gameState.gameTimer = 120;
  } else {
    gameState.gameTimer = 90; // 1.5 минуты на раунд в versus
  }
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

function endRound(winner) {
  gameState.phase = 'result';
  gameState.gameOver = true;
  gameState.winner = winner;
  
  if (gameState.mode === 'versus') {
    if (winner === 'defender') {
      gameState.roundsWon[gameState.round % 2]++;
    } else {
      gameState.roundsWon[(gameState.round + 1) % 2]++;
    }
    gameState.matchScores.push({
      round: gameState.round,
      defender: gameState.round % 2 === 0 ? players.player1 : players.player2,
      attacker: gameState.round % 2 === 0 ? players.player2 : players.player1,
      winner: winner,
      timeSurvived: gameState.gameTimer > 0 ? (gameState.mode === 'endless' ? 120 : 90) - gameState.gameTimer : 0
    });
    
    // Проверяем, не закончился ли матч
    if (gameState.round >= 3) {
      // Все 4 раунда сыграны
      gameState.phase = 'gameover';
    }
  } else {
    // Endless режим
    gameState.matchScores.push({
      timeSurvived: 120 - gameState.gameTimer,
      score1: gameState.score1,
      score2: gameState.score2
    });
  }
}

function switchSides() {
  // Меняем защитника и атакующего местами
  const temp = players.defender;
  players.defender = players.attacker;
  players.attacker = temp;
  
  // Уведомляем игроков о смене ролей
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
  
  // Таймер игры
  gameState.gameTimer -= dt;
  if (gameState.gameTimer <= 0) {
    // Время вышло
    if (gameState.mode === 'endless') {
      endRound('defender'); // Защитник выстоял
    } else {
      endRound('timeout');
    }
    return;
  }
  
  // Регенерация энергии зомби
  gameState.zombieEnergy = Math.min(250, gameState.zombieEnergy + 5 * dt);
  
  // Растения
  gameState.plants.forEach(p => {
    if (!p.alive) return;
    p.shootTimer = (p.shootTimer || 0) - dt;
    
    if (p.type === 'sunflower') {
      p.sunTimer = (p.sunTimer || 0) - dt;
      if (p.sunTimer <= 0) {
        gameState.sunDrops.push({
          x: p.x + (Math.random() - 0.5) * 40,
          y: p.y - 15,
          alive: true,
          value: 25
        });
        p.sunTimer = 8 + Math.random() * 4;
      }
    }
    
    if ((p.type === 'peashooter' || p.type === 'snowpea') && p.shootTimer <= 0) {
      const hasZombie = gameState.zombies.some(z =>
        z.row === p.row && z.alive && z.x > p.x && z.x < FIELD_START_X + COLS * CELL_W + 100
      );
      if (hasZombie) {
        gameState.projectiles.push({
          x: p.x + 20, y: p.y, row: p.row,
          damage: p.type === 'snowpea' ? 20 : 25,
          slow: p.type === 'snowpea',
          alive: true
        });
        p.shootTimer = 1.5;
      }
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
    
    let blocking = gameState.plants.find(p =>
      p.alive && p.row === z.row && Math.abs(z.x - p.x) < 45
    );
    
    if (blocking) {
      z.attackTimer = (z.attackTimer || 0) - dt;
      if (z.attackTimer <= 0) {
        blocking.hp -= z.damage;
        z.attackTimer = 0.7;
        if (blocking.hp <= 0) blocking.alive = false;
      }
    } else {
      const speed = z.slowed ? z.speed * 0.4 : z.speed;
      z.x -= speed * dt;
    }
    
    // Газонокосилка
    if (z.x < FIELD_START_X && gameState.lawnmowers[z.row]) {
      gameState.lawnmowers[z.row] = false;
      // Убиваем всех зомби в этом ряду
      gameState.zombies.forEach(zz => {
        if (zz.row === z.row && zz.alive) {
          zz.alive = false;
        }
      });
    }
    
    // Зомби дошёл до дома
    if (z.x < FIELD_START_X - 60 && !gameState.lawnmowers[z.row]) {
      z.alive = false;
      gameState.score2++;
      if (gameState.score2 >= 5) {
        endRound('attacker');
      }
    }
    
    if (z.hp <= 0) {
      z.alive = false;
      gameState.score1++;
      gameState.sunPoints += z.reward;
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
        if (p.slow) z.slowed = true;
        p.alive = false;
      }
    });
    
    if (p.x > ZOMBIE_SPAWN_X) p.alive = false;
  });
  
  // Случайное солнце
  if (Math.random() < dt * 0.12) {
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
      hp: z.hp, maxHp: z.maxHp, slowed: z.slowed || false
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
    spawnLocked: gameState.spawnLocked,
    prepTimer: Math.ceil(gameState.prepTimer),
    gameTimer: Math.ceil(gameState.gameTimer),
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
    players.defender = socket.id;
    socket.emit('role', 'defender');
    socket.emit('message', 'Вы Игрок 1. Выберите режим игры.');
    socket.emit('isHost', true);
  } else if (!players.player2) {
    players.player2 = socket.id;
    players.attacker = socket.id;
    socket.emit('role', 'attacker');
    socket.emit('message', 'Вы Игрок 2. Ожидайте выбора режима.');
  } else {
    socket.emit('error', 'Игра заполнена');
    socket.disconnect();
    return;
  }
  
  // Выбор режима (только хост)
  socket.on('selectMode', (mode) => {
    if (socket.id !== players.player1 || gameState.phase !== 'lobby') return;
    
    gameState.mode = mode;
    gameState.round = 0;
    startPrepPhase();
    io.emit('message', `Режим: ${mode === 'endless' ? 'Бесконечный бой' : 'Соревновательный (4 раунда)'}`);
  });
  
  // Посадка растения
  socket.on('plant', (data) => {
    if (socket.id !== players.defender || gameState.phase !== 'playing') return;
    if (gameState.sunPoints < PLANT_COSTS[data.type]) return;
    if (data.row < 0 || data.row >= ROWS || data.col < 0 || data.col >= COLS) return;
    if (gameState.plants.some(p => p.alive && p.row === data.row && p.col === data.col)) return;
    
    gameState.sunPoints -= PLANT_COSTS[data.type];
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
  
  // Сбор солнца
  socket.on('collect', (data) => {
    if (socket.id !== players.defender) return;
    const sun = gameState.sunDrops[data.id];
    if (sun && sun.alive) {
      gameState.sunPoints += sun.value;
      sun.alive = false;
    }
  });
  
  // Спавн зомби
  socket.on('zombie', (data) => {
    if (socket.id !== players.attacker || gameState.phase !== 'playing') return;
    if (gameState.spawnLocked) return;
    if (!ZOMBIE_COSTS[data.type]) return;
    if (gameState.zombieEnergy < ZOMBIE_COSTS[data.type]) return;
    
    const row = data.row !== undefined ? data.row : Math.floor(Math.random() * ROWS);
    if (row < 0 || row >= ROWS) return;
    
    gameState.zombieEnergy -= ZOMBIE_COSTS[data.type];
    const s = ZOMBIE_STATS[data.type];
    gameState.zombies.push({
      type: data.type, row: row,
      x: ZOMBIE_SPAWN_X + Math.random() * 80,
      y: FIELD_TOP_Y + row * CELL_H + CELL_H / 2,
      hp: s.hp, maxHp: s.hp, speed: s.speed,
      damage: s.damage, reward: s.reward,
      attackTimer: 0.5, slowed: false, alive: true
    });
  });
  
  // Орда
  socket.on('horde', () => {
    if (socket.id !== players.attacker || gameState.phase !== 'playing') return;
    if (gameState.spawnLocked) return;
    
    const types = ['basic', 'basic', 'cone'];
    types.forEach(type => {
      if (gameState.zombieEnergy < ZOMBIE_COSTS[type]) return;
      gameState.zombieEnergy -= ZOMBIE_COSTS[type];
      const s = ZOMBIE_STATS[type];
      const row = Math.floor(Math.random() * ROWS);
      gameState.zombies.push({
        type, row: row,
        x: ZOMBIE_SPAWN_X + Math.random() * 100,
        y: FIELD_TOP_Y + row * CELL_H + CELL_H / 2,
        hp: s.hp, maxHp: s.hp, speed: s.speed,
        damage: s.damage, reward: s.reward,
        attackTimer: 0.5, slowed: false, alive: true
      });
    });
  });
  
  // Следующий раунд (versus)
  socket.on('nextRound', () => {
    if (gameState.mode !== 'versus' || gameState.phase !== 'result') return;
    
    gameState.round++;
    if (gameState.round >= 4) {
      gameState.phase = 'gameover';
      io.emit('message', 'Матч окончен!');
    } else {
      switchSides();
      startPrepPhase();
      io.emit('message', `Раунд ${gameState.round + 1}/4. Стороны поменялись!`);
    }
  });
  
  // Рестарт игры
  socket.on('restart', () => {
    gameState = {
      mode: null,
      round: 0,
      phase: 'lobby',
      plants: [],
      zombies: [],
      projectiles: [],
      sunDrops: [],
      lawnmowers: Array(ROWS).fill(true),
      sunPoints: 300,
      zombieEnergy: 80,
      prepTimer: 15,
      gameTimer: 120,
      spawnLocked: true,
      score1: 0,
      score2: 0,
      roundsWon: [0, 0],
      matchScores: [],
      gameOver: false,
      winner: null,
      lastUpdate: Date.now()
    };
    players.defender = players.player1;
    players.attacker = players.player2;
    io.to(players.player1).emit('role', 'defender');
    io.to(players.player1).emit('isHost', true);
    io.to(players.player2).emit('role', 'attacker');
    io.emit('message', 'Игра перезапущена. Выберите режим.');
  });
  
  socket.on('disconnect', () => {
    console.log('Отключился:', socket.id);
    if (socket.id === players.player1) players.player1 = null;
    if (socket.id === players.player2) players.player2 = null;
    if (socket.id === players.defender) players.defender = null;
    if (socket.id === players.attacker) players.attacker = null;
    gameState.phase = 'lobby';
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🎮 Сервер на порту ' + PORT));
