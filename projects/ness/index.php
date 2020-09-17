<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "September 10, 2020";
$title = "Robotics Club Project: Ness";
$currentWebmaster = "Alexandra French";
$updateDate = "September 14, 2020";
$pageDescription = "Ness was our own autonomous submarine in 2017. It focused on modularity and neural networks.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, ness, autonomous sub, autonomous submarine, modularity";
$url = "https://robotics.ucf.edu/projects/ness/index.php";
$markupImage = "https://robotics.ucf.edu/projects/assets/imgs/ness.jpg";

// header functions and include
include_once("../../assets/templates/header.php");


// navbar
include_once("../../assets/templates/navbar.php");


// page content
include_once('assets/templates/ness.html');


// footer functions and include
include_once("../../assets/templates/footer.php");

?>
