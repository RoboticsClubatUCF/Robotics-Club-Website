<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 5, 2020";
$title = "Robotics Club Social Media Feed";
$currentWebmaster = "Alexandra French";
$updateDate = "September 14, 2020";
$pageDescription = "The Robotics Club of Central Florida has weekly workshops and regular posts for viewing.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, facebook, instagram, twitter, youtube, social media,
                               social media feed, feed";
$url = "https://robotics.ucf.edu/news/social-media.php";
$markupImage = "https://robotics.ucf.edu/more/assets/imgs/2020/workshops/spring-python.jpg";

// header functions and include
include_once("../assets/templates/header.php");


// navbar
include_once("../assets/templates/navbar.php");


// page content
include_once('assets/templates/social-media.html');


// footer functions and include
include_once("../assets/templates/footer.php");

?>
