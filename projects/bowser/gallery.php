<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 27, 2020";
$title = "Robotics Club Bowser's Gallery";
$currentWebmaster = "Alexandra French";
$updateDate = "September 14, 2020";
$pageDescription = "All of our photos of our autonomous robot, Bowser, including our working members, the bot itself, and any related event photos.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, photo gallery, Bowser photo gallery, bowser photos,
                               Bowser, Bowser gallery";
$url = "https://robotics.ucf.edu/projects/bowser/gallery.php";
$markupImage = "https://robotics.ucf.edu/projects/bowser/assets/imgs/gallery/bowser-full.jpg";

// header functions and include
include_once("../../assets/templates/header.php");


// navbar
include_once("../../assets/templates/navbar.php");


// page content
include_once('assets/templates/gallery.html');


// footer functions and include
include_once("../../assets/templates/footer.php");

?>
