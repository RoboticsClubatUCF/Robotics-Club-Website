<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 11, 2020";
$title = "Robotics Club Constitution";
$currentWebmaster = "Alexandra French";
$updateDate = "September 14, 2020";
$pageDescription = "Our club constitution, including how the club is run and the rules behind our workings";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, constitution, rules, amendments, amendment
                               articles";
$url = "https://robotics.ucf.edu/about/constitution";

// header functions and include
include_once("../assets/templates/header.php");


// navbar
include_once("../assets/templates/navbar.php");


// page content
require_once('assets/templates/constitution.html');


// footer functions and include
include_once("../assets/templates/footer.php");

?>
