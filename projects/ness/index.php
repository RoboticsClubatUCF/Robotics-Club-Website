<?php

// header functions and include
include_once("../../assets/templates/header.php");
$pageDescription = "Ness was our own autonomous submarine in 2017. It focused on modularity and neural networks.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, ness, autonomous sub, autonomous submarine, modularity";
$headerGen = new Header("Alexandra French", "September 10, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club Project: Ness", $pageDescription, $keywords, "https://robotics.ucf.edu/projects/ness/index");
$headerGen->generateCSS();
$headerGen->genProjectSEO("https://robotics.ucf.edu/projects/ness/index", "Robotics Club Project: Ness", $pageDescription, "August 2016", "https://robotics.ucf.edu/projects/assets/imgs/ness.jpg");
$headerGen->endHeader();


// navbar
include_once("../../assets/templates/navbar.php");
$navbarGen = new Navbar(False);


// page content
include_once('assets/templates/ness.html');


// footer functions and include
include_once("../../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$footerGen->generateJs();
$footerGen->endFile();

?>
