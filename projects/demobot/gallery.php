<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 27, 2020";
$title = "Robotics Club Demobot's Gallery";
$currentWebmaster = "Alexandra French";
$updateDate = "September 14, 2020";
$pageDescription = "Photos of our demonstration robot, Demobot, and all our club meetings, CAD schematics, and pictures of Demobot.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, demonstrative robot photos, demonstration robot photos,
                               demobot photo gallery, demobot photos";
$url = "https://robotics.ucf.edu/projects/demobot/gallery.php";
$markupImage = "https://robotics.ucf.edu/projects/demobot/assets/imgs/gallery/demobot-sm-1.jpg";

// header functions and include
include_once("../../assets/templates/header.php");


// navbar
include_once("../../assets/templates/navbar.php");


// page content
include_once('assets/templates/gallery.html');


// footer functions and include
include_once("../../assets/templates/footer.php");

?>
