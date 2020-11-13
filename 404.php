<?php

// header functions and include
include_once("assets/templates/header.php");

// print out the header comment, common components, css, and SEO
$pageDescription = "This page is unfortunately not found. Contact the webmaster / club on Discord or via email.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, 404, file not found, page not found, not                                  found, found, not, page, file, error";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("404 - Page Not Found", $pageDescription, $keywords, "https://robotics.ucf.edu/404");
$headerGen->generateCSS();
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/404", "404 - Page Not Found", $pageDescription);
$headerGen->endHeader();


// navbar
include_once("assets/templates/navbar.php");
$navbarGen = new Navbar(False);


// page content
require_once('assets/templates/404.html');


// footer functions and include
include_once("assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$footerGen->generateJs();
$footerGen->endFile();

?>
