<?php

// header functions and include
include_once("../../assets/templates/header.php");
$pageDescription = "Metaknight was our autonomous ground vehicle for IGVC in 2017.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, autonomous ground vehicle, igvc, metaknight";
$headerGen = new Header("Alexandra French", "September 10, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club Project: Metaknight", $pageDescription, $keywords, "https://robotics.ucf.edu/projects/metaknight/index");
$headerGen->generateCSS();
$headerGen->genProjectSEO("https://robotics.ucf.edu/projects/metaknight/index", "Robotics Club Project: Metaknight", $pageDescription, "August 2016", "https://robotics.ucf.edu/projects/assets/imgs/metaknight.jpg");
$headerGen->endHeader();


// navbar
include_once("../../assets/templates/navbar.php");
$navbarGen = new Navbar(False);


// page content
include_once('assets/templates/metaknight.html');


// footer functions and include
include_once("../../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$footerGen->generateJs();
$footerGen->endFile();

?>
