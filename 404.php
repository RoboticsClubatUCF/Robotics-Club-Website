<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 5, 2020";
$title = "404 - Page Not Found Test";
$currentWebmaster = "Alexandra French";
$updateDate = "September 14, 2020";
$pageDescription = "This page is unfortunately not found. Contact the webmaster / club on Discord or via email.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, 404, file not found, page not found, not found, found, not, page,
                               file, error";
$url = "https://robotics.ucf.edu/404";


// header functions and include
include_once("assets/templates/header.php");


// navbar
include_once("assets/templates/navbar.php");


// page content
require_once('assets/templates/404.html');


// footer functions and include
include_once("assets/templates/footer.php");
$footerGen = new Footer();

$footerGen->generateFooter(2020);
$footerGen->generateJs();
$footerGen->endFile();

?>
