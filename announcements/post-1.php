<?php

// header functions and include
include_once("../assets/templates/header.php");
$pageDescription = "Robotics Club of Central Florida has a new website. Learn about our new pages, checkout some new features, and enjoy darkmode.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, new website, new, upgrade, upgraded website, new Webmaster";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club New Website", $pageDescription, $keywords, "https://robotics.ucf.edu/announcements/post-1");
$headerGen->generateCSS();
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/announcements/post-1", "Robotics Club New Website", $pageDescription,  "https://robotics.ucf.edu/announcements/assets/imgs/posts/new-website.jpg");
$headerGen->endHeader();


// navbar
include_once("../assets/templates/navbar.php");
$navbarGen = new Navbar(False);


// page content
include_once('assets/templates/post-1.html');


// footer functions and include
include_once("../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$footerGen->generateJs();
$footerGen->endFile();

?>
