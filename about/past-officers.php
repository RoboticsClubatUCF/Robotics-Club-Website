<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 25, 2020";
$title = "Robotics Club Past Officers";
$currentWebmaster = "Alexandra French";
$updateDate = "September 14, 2020";
$pageDescription = "The Robotics Club of Central Florida has kept our history of officers and leaders in the 2020s.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, past members, 2020s, current memebrs, past members 2020s";
$url = "https://robotics.ucf.edu/about/past-officers.php";

// header functions and include
include_once("../assets/templates/header.php");


// navbar
include_once("../assets/templates/navbar.php");


// page content
include_once('assets/templates/past-officers.html');


// footer functions and include
include_once("../assets/templates/footer.php");

?>
