<?php

// header functions and include
include_once("../assets/templates/header.php");
$pageDescription = "Learn more about the Robotics Club of Central Florida's recent events through our newsletter.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, news, newsletter, club news";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club Newsletter", $pageDescription, $keywords, "https://robotics.ucf.edu/news/index");
$headerGen->generateCSS(array("assets/css/mailchimp.css"));
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/news/index", "Robotics Club Newsletter", $pageDescription);
$headerGen->endHeader();


// navbar
include_once("../assets/templates/navbar.php");
$navbarGen = new Navbar(False);


// page content
include_once('assets/templates/newsletter.html');


// footer functions and include
include_once("../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$footerGen->generateJs();
$footerGen->endFile();

?>
