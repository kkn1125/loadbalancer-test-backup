const uWs = require("uWebSockets.js");
const { emitter } = require("./src/emitter");
const User = require("./src/models/User");
const { Message } = require("./src/protobuf");

/**
 * PORT               === 서버 포트
 * sockets            === sockets 맵
 * users              === users 맵
 * isDisableKeepAlive === keepalive 설정
 * deviceID           === 디바이스 인덱스
 * server             === 스레드 === 서버
 * sp                 === 공간
 * ch                 === 채널
 * targetServerName   === 타겟 서버 명
 */
const PORT = Number(process.env.PORT || 3000);
const sockets = new Map();
const users = new Map();
let isDisableKeepAlive = false;
let deviceID = 0;
let se = 1;
let sp = "a";
let ch = 1;
let targetServerName = "";

/**
 * Protobuf 규격 초기화
 */
const declareProtobuf = new Message({
  id: "fixed32",
  type: "string",
  nickname: "string",
  device: "string",
  deviceID: "string",
  authority: "bool",
  avatar: "string",
  pox: "float",
  poy: "float",
  poz: "float",
  roy: "float",
  state: "string",
  host: "string",
  timestamp: "fixed64",
});

const app = uWs
  .App({})
  .ws(`/*`, {
    /* Options */
    idleTimeout: 32,
    maxBackpressure: 1024,
    maxPayloadLength: 1024, // 패킷 데이터 용량 (용량이 넘을 시 서버 끊김)
    compression: uWs.DEDICATED_COMPRESSOR_3KB,
    /* Handlers */
    upgrade: upgradeHandler,
    open: openHandler,
    message: messageHandler,
    drain: drainHandler,
    close: closeHandler,
  })
  // port는 숫자여야합니다. 아니면 열리지 않습니다... 😂
  .listen(PORT, (listenSocket) => {
    console.log(`listening on ws://locahost:${PORT}`);
    if (listenSocket) {
      console.log(`${PORT}번 포트 열었음`);
    }
  });

function upgradeHandler(res, req, context) {
  /**
   * 쿼리 가지고 옴
   */
  const params = Object.fromEntries(
    req
      .getQuery()
      .split("&")
      .filter((q) => q)
      .map((q) => q.split("="))
  );
  const href = req.getHeader("origin") + req.getUrl() + "?" + req.getQuery();
  const host = req.getHeader("origin").match(/http(s)?:\/\/([\w\W]+)/)[2];
  res.upgrade(
    {
      url: req.getUrl(),
      params: params,
      /* 파라미터 추가되는 값 아래에 필드 추가 */
      space: params.sp,
      href: href,
      host: host,
    },
    /* Spell these correctly */
    req.getHeader("sec-websocket-key"),
    req.getHeader("sec-websocket-protocol"),
    req.getHeader("sec-websocket-extensions"),
    context
  );
}

function openHandler(ws) {
  if (isDisableKeepAlive) {
    ws.close();
  }
  const { url, params, space, href, host } = ws;

  sp = params.sp;

  const user = new User({
    id: 1,
    type: "viewer",
    timestamp: new Date().getTime(),
    deviceID: deviceID,
    server: se,
    space: sp,
    channel: ch,
    host: host,
  }).toJSON();

  sockets.set(ws, deviceID);
  users.set(ws, user);

  targetServerName = `server${user.server}`;
  emitter.emit(`${targetServerName}::open`, app, users.get(ws));

  deviceID++;
}

function messageHandler(ws, message, isBinary) {
  /* Ok is false if backpressure was built up, wait for drain */
  // let ok = ws.send(message, isBinary);
  if (isBinary) {
    /**
     * Player 로그인 시 / protobuf 메세지
     */
    const messageObject = JSON.parse(
      JSON.stringify(Message.decode(new Uint8Array(message)))
    );
    /** overriding user data */
    const overrideUserData = Object.assign(users.get(ws), messageObject);
    users.set(ws, overrideUserData);

    emitter.emit(`${targetServerName}::login`, app, users.get(ws));
  } else {
    // 일반 json stringify 메세지
    // const strings = decoder.decode(new Uint8Array(message));
    // const json = JSON.parse(strings);
    // const viewerData = Object.assign(json, {
    // });
    // emitter.emit(app, json);
  }
}

function drainHandler(ws) {
  console.log("WebSocket backpressure: " + ws.getBufferedAmount());
}

function closeHandler(ws, code, message) {
  console.log(`${sockets.get(ws)}번 종료`);
  console.log("WebSocket closed");
}

/**
 * 프로세스 죽었을 때 SIGINT 이벤트 전달
 */
process.on("SIGINT", function () {
  isDisableKeepAlive = true;
  app.close(function () {
    process.exit(0);
  });
});

process.send("ready");

module.exports = { app };