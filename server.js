//подключаем библиотеки
const express = require("express");
const useSocket = require("socket.io");
const db = require("./db");
const cors = require("cors");

const app = express(); //создаем объект приложения
const server = require("http").Server(app); //рабрта сервера через приложение express
const io = useSocket(server, {
  cors: {
    origin: "*",
  },
  pingTimeout: 60000,
});

//cors заголовки
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "https://artkurkin.github.io");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header(
    "Access-Control-Allow-Methods",
    "DELETE, PUT, UPDATE, HEAD, OPTIONS, GET, POST"
  );
  next();
});

// app.use(
//   cors({
//     origin: "https://artkurkin.github.io",
//   })
// );

app.use(express.json());

const rooms = new Map();

app.post("/newroom", async (req, res) => {
  const { roomName, userId } = req.body;

  const createdRoom = await db.query(
    `insert into ROOMS (name) values ($1) returning *`,
    [roomName]
  );

  const addRoom = await db.query(
    `insert into ROOMS_USERS (id_room, id_user) values ($1, $2) returning *`,
    [createdRoom.rows[0].id, +userId]
  );

  res.json({ roomName: createdRoom.rows[0].name });
});

app.post("/users", async (req, res) => {
  const { roomName } = req.body;

  const roomId = await db.query(`select id from ROOMS where name = $1`, [
    roomName,
  ]);

  if (roomName) {
    const usersInRooms = await db.query(
      `select USERS.name, USERS.isOnline from ROOMS_USERS join USERS on USERS.id = ROOMS_USERS.id_user and ROOMS_USERS.id_room = $1`,
      [roomId.rows[0].id]
    );
    res.json(usersInRooms.rows);
  }
});

app.post("/room", async (req, res) => {
  const { room, userId } = req.body;

  const roomId = await db.query(`select id from ROOMS where name = $1`, [room]);

  const addRoom = await db.query(
    `insert into ROOMS_USERS (id_room, id_user) values ($1, $2) returning *`,
    [roomId.rows[0].id, +userId]
  );

  res.json({ room: addRoom.rows[0].name });
});

app.get("/rooms/:id", async (req, res) => {
  const { id: userId } = req.params;

  const usersRooms = await db.query(
    `select ROOMS.name from ROOMS_USERS join ROOMS on ROOMS.id = ROOMS_USERS.id_room and ROOMS_USERS.id_user = $1`,
    [+userId]
  );

  const roomsObj = usersRooms.rows.map((name) => {
    return name.name;
  });

  res.json(roomsObj);
});

app.post("/rooms", async (req, res) => {
  const { roomName } = req.body;
  const rooms = await db.query(`select * from ROOMS where name = $1`, [
    roomName.toString(),
  ]);

  let obj = {};
  if (!rooms.rows.length) {
    res.json({ rooms: [] });
  } else {
    const filterRoom = rooms.rows.map((room) => {
      return room.name;
    });
    res.json(filterRoom);
  }
});

io.on("connection", (socket) => {
  socket.on("JOIN", async ({ userName }) => {
    const users = await db.query(`select * from USERS where name = $1`, [
      userName,
    ]);
    let currentUser;

    if (!users.rows.length) {
      currentUser = await db.query(
        `INSERT INTO USERS (name, isOnline, current_socket_id) values ($1, true, $2) RETURNING *`,
        [userName, socket.id.toString()]
      );
    } else {
      currentUser = await db.query(
        `update USERS set isOnline = true, current_socket_id = $1 where id = $2 returning *`,
        [socket.id.toString(), users.rows[0].id]
      );
    }

    const usersRooms = await db.query(
      `select ROOMS.name from ROOMS_USERS join ROOMS on ROOMS.id = ROOMS_USERS.id_room and ROOMS_USERS.id_user = $1`,
      [currentUser.rows[0].id]
    );

    const roomsObj = usersRooms.rows.map((name) => {
      return name.name;
    });

    socket.emit("ROOM:SET_USER", {
      userName: currentUser.rows[0].name,
      userId: currentUser.rows[0].id,
      rooms: roomsObj,
    });
  });

  socket.on("CONNECT_ROOM", async (data) => {
    const roomId = await db.query(`select id from ROOMS where name = $1`, [
      data.roomName,
    ]);

    if (data.roomName) {
      if (!socket.rooms.has(data.roomName)) {
        socket.join(data.roomName);
      }

      io.to(data.roomName).emit("SET_USERS_REQUEST");
    }
  });

  socket.on("GET_USERS", async (data) => {
    const roomId = await db.query(`select id from ROOMS where name = $1`, [
      data.roomName,
    ]);

    if (data.roomName) {
      const usersInRooms = await db.query(
        `select USERS.name, USERS.isOnline from ROOMS_USERS join USERS on USERS.id = ROOMS_USERS.id_user and ROOMS_USERS.id_room = $1`,
        [roomId.rows[0].id]
      );

      socket.emit("SET_USERS", usersInRooms.rows);
    }
  });

  socket.on("GET_MESSAGES", async (data) => {
    const roomId = await db.query(`select id from ROOMS where name = $1`, [
      data.roomName,
    ]);

    if (data.roomName) {
      const messages = await db.query(
        `select MESSAGES.content, MESSAGES.id, USERS.name from MESSAGES join USERS on USERS.id = MESSAGES.id_user and MESSAGES.id_room = $1`,
        [roomId.rows[0].id]
      );

      const sortedMessages = messages.rows.map(
        ({ content: text, name: userName, id: idMessage }) => {
          return { userName, text, idMessage };
        }
      );

      socket.emit("MESSAGES", sortedMessages);
    }
  });

  socket.on("ROOM:NEW_MESSAGE", async ({ roomId, userName, text }) => {
    const obj = { userName, text };

    const roomName = [...socket.rooms.values()][1];

    const name = await db.query(`select id from USERS where name = $1`, [
      userName,
    ]);
    const room = await db.query(`select id from ROOMS where name = $1`, [
      roomName,
    ]);

    const messages = await db.query(
      `insert into MESSAGES (content, id_room, id_user) values ($1, $2,$3)`,
      [text, room.rows[0].id, name.rows[0].id]
    );
    socket.to(roomName).emit("ROOM:NEW_MESSAGE", obj);
  });

  socket.on("EDIT_MESSAGE", async (data) => {
    const editedMessage = await db.query(
      "update MESSAGES set content = $1 where id = $2",
      [data.changeText, data.message.idMessage]
    );

    const roomId = await db.query(`select id from ROOMS where name = $1`, [
      data.roomName,
    ]);

    const messages = await db.query(
      `select MESSAGES.content, MESSAGES.id, USERS.name from MESSAGES join USERS on USERS.id = MESSAGES.id_user and MESSAGES.id_room = $1 ORDER BY MESSAGES.id`,
      [roomId.rows[0].id]
    );

    const sortedMessages = messages.rows.map(
      ({ content: text, name: userName, id: idMessage }) => {
        return { userName, text, idMessage };
      }
    );

    io.to(data.roomName).emit("MESSAGES", sortedMessages);
  });

  socket.on("DELETE_MESSAGE", async (data) => {
    const editedMessage = await db.query("delete from MESSAGES where id = $1", [
      data.message.idMessage,
    ]);

    const roomId = await db.query(`select id from ROOMS where name = $1`, [
      data.roomName,
    ]);

    const messages = await db.query(
      `select MESSAGES.content, MESSAGES.id, USERS.name from MESSAGES join USERS on USERS.id = MESSAGES.id_user and MESSAGES.id_room = $1 ORDER BY MESSAGES.id`,
      [roomId.rows[0].id]
    );

    const sortedMessages = messages.rows.map(
      ({ content: text, name: userName, id: idMessage }) => {
        return { userName, text, idMessage };
      }
    );

    io.to(data.roomName).emit("MESSAGES", sortedMessages);
  });

  socket.on("NEW_MESSAGES", async (data) => {
    const roomId = await db.query(`select id from ROOMS where name = $1`, [
      data.roomName,
    ]);

    const message = await db.query(
      `insert into MESSAGES (content, id_room, id_user) values ($1, $2,$3)`,
      [data.content, roomId.rows[0].id, data.userId]
    );

    const messages = await db.query(
      `select MESSAGES.content, MESSAGES.id, USERS.name from MESSAGES join USERS on USERS.id = MESSAGES.id_user and MESSAGES.id_room = $1 ORDER BY MESSAGES.id`,
      [roomId.rows[0].id]
    );

    const sortedMessages = messages.rows.map(
      ({ content: text, name: userName, id: idMessage }) => {
        return { userName, text, idMessage };
      }
    );

    io.to(data.roomName).emit("MESSAGES", sortedMessages);
  });

  socket.on("QUIT_ROOM", async (data) => {
    const roomId = await db.query(`select id from ROOMS where name = $1`, [
      data.roomName,
    ]);

    const quitedRoom = await db.query(
      "delete from ROOMS_USERS where id_room = $1 and id_user = $2 returning *",
      [roomId.rows[0].id, data.userId]
    );

    const usersRooms = await db.query(
      `select ROOMS.name from ROOMS_USERS join ROOMS on ROOMS.id = ROOMS_USERS.id_room and ROOMS_USERS.id_user = $1`,
      [data.userId]
    );

    const roomsObj = usersRooms.rows.map((name) => {
      return name.name;
    });

    socket.leave(data.roomName);

    socket.emit("QUITED_USER", {
      rooms: roomsObj,
    });

    socket.to(data.roomName).emit("SET_USERS_REQUEST");
  });

  socket.on("disconnecting", async (reason) => {
    console.log(reason);

    const newUsers = await db.query(
      `UPDATE USERS set isOnline = false, current_socket_id = null where current_socket_id = $1 returning *`,
      [socket.id.toString()]
    );

    if (newUsers.rows.length) {
      const roomName = await db.query(
        `select ROOMS.name, ROOMS.id from ROOMS_USERS join ROOMS on ROOMS.id = ROOMS_USERS.id_room where ROOMS_USERS.id_user = $1`,
        [newUsers.rows[0].id]
      );

      const filterRoom = roomName.rows.map((room) => {
        return room.name;
      });

      socket.to(filterRoom).emit("QUIT_USER");
    }
  });
});

//начинаем прослушивать подключение на 9999 порту
server.listen(process.env.PORT, (err) => {
  if (err) {
    throw Error(err);
  }
  console.log("Сервер запущен");
});
