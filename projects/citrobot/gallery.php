<?php

// header functions and include
include_once("../../assets/templates/header.php");
$pageDescription = "Photos of our 15lb combat robot, including group members, the robot, schematics, and other photos involving Citrobot.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, photo gallery, citrobot photo gallery, citrobot photos, 15lb combat robot                                 photos, combat robot photos";
$headerGen = new Header("Alexandra French", "August 27, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club Citrobot's Gallery", $pageDescription, $keywords, "https://robotics.ucf.edu/projects/citrobot/gallery");
$headerGen->generateCSS();
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/projects/citrobot/gallery", "Robotics Club Citrobot's Gallery", $pageDescription, "https://robotics.ucf.edu/projects/citrobot/assets/imgs/gallery/citrobot-sm-5.jpg");
$headerGen->endHeader();


// navbar
include_once("../../assets/templates/navbar.php");
$navbarGen = new Navbar(False);

// page content
include_once('assets/templates/gallery.html');


// footer functions and include
include_once("../../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$footerGen->generateJs();
$footerGen->endFile();

?>
