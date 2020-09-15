<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 5, 2020";
$title = "About The Robotics Club";
$currentWebmaster = "Alexandra French";
$updateDate = "September 14, 2020";
$pageDescription = "The Robotics Club of Central Florida is a student club focused on exploring and advancing robotics.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, about, about us, new members, welcome, mission";
$url = "https://robotics.ucf.edu/about/index.php";

// header functions and include
include_once("../assets/templates/header.php");


// navbar
include_once("../assets/templates/navbar.php");


// page content
include_once('assets/templates/about-us.html');
include_once('assets/templates/our-officers.html');
include_once('assets/templates/our-advisors.html');
include_once('assets/templates/our-members.html');


// footer functions and include
include_once("../assets/templates/footer.php");

?>
