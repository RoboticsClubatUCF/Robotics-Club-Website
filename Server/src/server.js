const express = require('express');
const mongoose = require('mongoose');
const cors = require("cors")
const app = express();
const PORT = process.env.PORT || 4000;

//get db info
const db = require("./Models");
const Project = require('./Models/Project');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

//Initiate MongoDB and start server
app.listen(PORT, () => {
    mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:4800/RCCF', { useNewUrlParser: true }).then((response) => {
        console.log(`Connected to MongoDB and server started on PORT ${PORT}`);
    }).catch((err) => {
        console.log(err);
    })
});
app.get('/api/projects',async (req,res,next)=>{
    const projects = await db.projects.find();
    return res.json(projects);
})
app.post('/api/projects', async (req, res, next) => {
    const project = new Project(req.body);
    // save todo to database
    await project.save();
    return res.json(project);
});
app.delete('/api/projects', async (req, res, next) => {
    // find todo by id and delete
    await Project.findByIdAndDelete(req.body.id);                   

    return res.json({
        message: 'Todo deleted successfully',
        success: true,
    });
});
