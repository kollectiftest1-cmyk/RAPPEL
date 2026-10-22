module.exports = {
  apps: [{
    name: 'rappel-whatsapp',
    script: 'src/server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    time: true
  }]
};
