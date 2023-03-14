const Role = {
    Member: "MEMBER",
    Teamlead: "TEAMLEAD",
    Officer: "OFFICER"
}

module.exports = (mongoose) => {
    var schema = mongoose.Schema({
        firstName: String,
        lastName: String,
        pass: String,
        projects: [String],
        position: {
            type: String,
            enum: Role,
            default: Role.Member
        }
    }, {
        timestamps: true
    });
    const User = mongoose.model("user", schema);
	return User;
}