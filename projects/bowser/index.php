<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 5, 2020";
$title = "Robotics Club Project: Bowser";
$currentWebmaster = "Alexandra French";
$updateDate = "September 14, 2020";
$pageDescription = "Bowser is our smart, self-controlled, and fast autonomous ground robot.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, autonomous ground vehicle, Bowser, IGVC";
$url = "https://robotics.ucf.edu/projects/bowser/index.php";
$markupImage = "https://robotics.ucf.edu/projects/assets/imgs/bowser.jpg";

// header functions and include
include_once("../../assets/templates/header.php");


// navbar
include_once("../../assets/templates/navbar.php");


// page content
include_once('assets/templates/bowser.html');


// footer functions and include
include_once("../../assets/templates/footer.php");

?>
