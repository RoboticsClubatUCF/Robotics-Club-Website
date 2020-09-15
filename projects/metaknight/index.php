<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "September 10, 2020";
$title = "Robotics Club Project: Metaknight";
$currentWebmaster = "Alexandra French";
$updateDate = "September 14, 2020";
$pageDescription = "Metaknight was our autonomous ground vehicle for IGVC in 2017.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, autonomous ground vehicle, igvc, metaknight";
$url = "https://robotics.ucf.edu/projects/metaknight/index.php";
$markupImage = "https://robotics.ucf.edu/projects/assets/imgs/metaknight.jpg";

// header functions and include
include_once("../../assets/templates/header.php");


// navbar
include_once("../../assets/templates/navbar.php");


// page content
include_once('assets/templates/metaknight.html');


// footer functions and include
include_once("../../assets/templates/footer.php");

?>
