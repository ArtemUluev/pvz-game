const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const ROWS = 5, COLS = 9;
const FIELD_START_X = 150, CELL_W = 85, CELL_H = 90, FIELD_TOP_Y = 120;
const FIELD_END_X = FIELD_START_X + COLS * CELL_W;

const ALL_PLANTS = { ... }; // те же данные
const ALL_ZOMBIES = { ... }; // те же данные

let players = { player1: null, player2: null, defender: null, attacker: null };
let player1Plants = ['sunflower','peashooter','snowpea','walnut','cherrybomb'];
let player2Plants = ['sunflower','peashooter','snowpea','walnut','cherrybomb'];
let player1Zombies = ['basic','cone','bucket','runner','gargantuar'];
let player2Zombies = ['basic','cone','bucket','runner','gargantuar'];

let game = { ... }; // всё как раньше

// Проверка, что basic присутствует в списке зомби
function ensureBasic(list) {
  if (!list.includes('basic')) {
    list.unshift('basic');
    if (list.length > 5) list.pop();
  }
  return list;
}

function resetRound() { ... }
function getPlantStats(type) { return ALL_PLANTS[type]; }
function getZombieStats(type) { return ALL_ZOMBIES[type]; }
function unlockTiers() { ... }
function endRound(winner) { ... }
function switchSides() { ... }
function update() { ... }  // вся игровая логика без изменений
function spawnAutoHorde() { ... }
function broadcast() { ... }

setInterval(() => { ... }, 1000/30);

io.on('connection', socket => {
  if (!players.player1) {
    players.player1 = socket.id;
    players.defender = socket.id;
    socket.emit('role','defender');
    socket.emit('isHost', true);
  } else if (!players.player2) {
    players.player2 = socket.id;
    players.attacker = socket.id;
    socket.emit('role','attacker');
  } else {
    socket.emit('error','Полно');
    socket.disconnect();
    return;
  }

  socket.on('selectMode', mode => {
    if (socket.id === players.player1 && game.phase === 'lobby') {
      game.mode = mode;
      game.phase = 'customize';
      io.emit('message','Настройте свои войска!');
    }
  });

  socket.on('setPlants', p => {
    if (socket.id === players.player1) player1Plants = p.slice(0,5);
    else player2Plants = p.slice(0,5);
  });

  socket.on('setZombies', z => {
    z = ensureBasic(z.slice(0,5));
    if (socket.id === players.player1) player1Zombies = z;
    else player2Zombies = z;
  });

  socket.on('startGame', () => {
    if (game.phase !== 'customize') return;
    // убеждаемся, что basic есть у обоих
    player1Zombies = ensureBasic(player1Zombies);
    player2Zombies = ensureBasic(player2Zombies);
    game.round = 0;
    resetRound();
    game.phase = 'prep';
    io.emit('message','Приготовьтесь!');
  });

  socket.on('plant', data => { ... }); // без изменений
  socket.on('collect', data => { ... });
  socket.on('zombie', data => { ... });
  socket.on('nextRound', () => { ... });
  socket.on('restart', () => { ... });
  socket.on('disconnect', () => { ... });
});

server.listen(process.env.PORT||3000, () => console.log('Сервер v4.1'));
