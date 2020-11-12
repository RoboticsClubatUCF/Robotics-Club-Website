<?php

// header content
include_once('assets/templates/header.php');
$pageDescription = "The Robotics Club of Central Florida is a student powered club based on hands on work with autonomous robotics.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club of Central Florida", $pageDescription, $keywords, "https://robotics.ucf.edu/");
$headerGen->generateCSS(array("assets/css/index.css"));
$headerGen->genOrgSEO("https://robotics.ucf.edu/", "Robotics Club of Central Florida", $pageDescription, "(407) 882-0293", "robotics@ucf.edu", "https://robotics.ucf.edu/assets/imgs/bowser.jpg");
$headerGen->endHeader();

// page content with snap containers
include_once('assets/templates/snap-index.php');

// footer content
include_once('assets/templates/footer.php');
$footerGen = new Footer();

$customJs = array("/assets/js/index.js");
$footerGen->generateJs($customJs);
$footerGen->endFile();

?>
