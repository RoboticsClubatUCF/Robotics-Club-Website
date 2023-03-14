const Seasons = {
    spring: "SPRING",
    summer: "SUMMER",
    fall: "FALL"
}
module.exports = (mongoose) => {
    var schema = mongoose.Schema({
        title: String,
        description: String,
        season: {
            type: String,
            enum: Seasons,
            default: Seasons.fall
        },
        year: Number,
        teamleads: [String],
        members: [String],
    }, {
        timestamps: true
    })
    const Project = mongoose.model("project", schema);
    return Project;
}