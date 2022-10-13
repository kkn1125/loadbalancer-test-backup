const uWs = require("uWebSockets.js");
const User = require("./src/models/User");
const { Message } = require("./src/protobuf");
const pm2 = require("pm2");
const { emitter } = require("./src/emitter");

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
 * decoder            === message가 바이너리가 아닐 때
 */
const PORT = process.env.NODE_ENV?.trim() === "development" ? 4000 : 3000;
const sockets = new Map();
const users = new Map();
let isDisableKeepAlive = false;
let deviceID = 0;
let currentServer = 1;
let sp = "a"; // 공간은 URL 배정 받음
let targetServerName = "";
const decoder = new TextDecoder();

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
  const host =
    req.getHeader("origin").match(/http(s)?:\/\/([\w\W]+)/)?.[2] || "test";
  res.upgrade(
    {
      url: req.getUrl(),
      params: params,
      /* 파라미터 추가되는 값 아래에 필드 추가 */
      space: params.sp.toLowerCase() || "a",
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
  deviceID++;

  if (isDisableKeepAlive) {
    ws.close();
  }
  const { url, params, space, href, host } = ws;

  sp = params.sp;

  const user = new User({
    id: null,
    type: "viewer",
    timestamp: new Date().getTime(),
    deviceID: deviceID,
    server: currentServer,
    space: sp,
    // channel: ch,
    host: host,
  }).toJSON();

  /**
   * 전체 서버 구독
   */
  ws.subscribe("server");
  sockets.set(ws, deviceID);
  users.set(ws, user);

  targetServerName = `server${user.server}`;
  console.log("open", users.get(ws));
  emitter.emit(`${targetServerName}::open`, app, ws, users.get(ws));
}

function messageHandler(ws, message, isBinary) {
  // console.log(message, isBinary)
  if (isBinary) {
    /**
     * Player 로그인 시 / protobuf 메세지
     */
    let messageObject;
    try {
      messageObject = JSON.parse(
        JSON.stringify(Message.decode(new Uint8Array(message)))
      );
    } catch (e) {}
    /** overriding user data */
    console.log("login", messageObject);
    console.log("client=>", users.get(ws));
    const overrideUserData = Object.assign(users.get(ws), messageObject);
    console.log(overrideUserData);
    users.set(ws, overrideUserData);

    try {
      emitter.emit(`${targetServerName}::login`, app, users.get(ws));
    } catch (e) {}
  } else {
    const data = JSON.parse(decoder.decode(message));
    console.log("location", data);
    try {
      emitter.emit(`${targetServerName}::location`, app, data, message);
    } catch (e) {}

    /**
     * require chat message emit
     */
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
  console.log("WebSocket closed");
  try {
    emitter.emit(`${targetServerName}::close`, app, users.get(ws));
  } catch (e) {}
}

/**
 * 서버 부하 검사
 */
emitter.on(`receive::balancer`, (state, serverName) => {
  const serverNumber = Number(serverName.match(/server([\d]+)/)[1]);
  // console.log(serverNumber);
  if (state === "busy") {
    currentServer += 1; // 서버 수 증가
    console.log(currentServer, "번 서버 실행!");
    console.log("it's too busy!!");
  } else if (state === "comfortable") {
    console.log("comfortable!");
  }
});

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

module.exports = { app, emitter };
