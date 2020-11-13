<?php

// header functions and include
include_once("../assets/templates/header.php");
$pageDescription = "Our club constitution, including how the club is run and the rules behind our workings";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, constitution, rules, amendments, amendment
                               articles";
$headerGen = new Header("Alexandra French", "August 11, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club Constitution", $pageDescription, $keywords, "https://robotics.ucf.edu/about/constitution");
$headerGen->generateCSS();
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/about/constitution", "Robotics Club Constitution", $pageDescription);
$headerGen->endHeader();

// navbar
include_once("../assets/templates/navbar.php");
$navbarGen = new Navbar(False);


// page content
require_once('assets/templates/constitution.html');


// footer functions and include
include_once("../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$customJs = array("../assets/js/alert.js");
$footerGen->generateJs($customJs);
$footerGen->endFile();

?>
