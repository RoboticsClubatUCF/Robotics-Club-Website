<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 27, 2020";
$title = "Robotics Club Citrobot's Gallery";
$currentWebmaster = "Alexandra French";
$updateDate = "September 14, 2020";
$pageDescription = "Photos of our 15lb combat robot, including group members, the robot, schematics, and other photos involving Citrobot.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, photo gallery, citrobot photo gallery, citrobot photos, 15lb combat robot photos,
                               combat robot photos";
$url = "https://robotics.ucf.edu/projects/citrobot/gallery";
$markupImage = "https://robotics.ucf.edu/projects/citrobot/assets/imgs/gallery/citrobot-sm-5.jpg";

// header functions and include
include_once("../../assets/templates/header.php");


// navbar
include_once("../../assets/templates/navbar.php");


// page content
include_once('assets/templates/gallery.html');


// footer functions and include
include_once("../../assets/templates/footer.php");

?>
