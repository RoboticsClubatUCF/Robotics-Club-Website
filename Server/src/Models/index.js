const mongoose = require("mongoose")

mongoose.Promise = global.Promise;

const db = {}
db.mongoose = mongoose;

db.users = require("./User.js")(mongoose)
db.projects = require("./Project.js")(mongoose)

module.exports = db