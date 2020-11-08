<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 5, 2020";
$title = "Robotics Club 2019 Photo Gallery";
$currentWebmaster = "Alexandra French";
$updateDate = "September 14, 2020";
$pageDescription = "The Robotics Club of Central Florida has collecteda photo gallery from past socials and workshops throughout 2019.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, photo gallery, photo gallery 2019, social photos 2019,
                               social photos";
$url = "https://robotics.ucf.edu/more/gallery-2019";
$markupImage = "https://robotics.ucf.edu/more/assets/imgs/2019/halloween-2.jpg";

// header functions and include
include_once("../assets/templates/header.php");


// navbar
include_once("../assets/templates/navbar.php");


// page content
include_once('assets/templates/gallery-2019.html');


// footer functions and include
include_once("../assets/templates/footer.php");

?>
