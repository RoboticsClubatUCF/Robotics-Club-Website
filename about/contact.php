<?php

// header functions and include
include_once("../assets/templates/header.php");
$pageDescription = "The Robotics Club of Central Florida invites you to visit us at any time, email us, or join us on Discord.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, contact, us, twitter, facebook, instagram, youtube
                               map, location, contact, us";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Contact the Robotics Club", $pageDescription, $keywords, "https://robotics.ucf.edu/about/contact");
$headerGen->generateCSS();
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/about/contact", "Contact the Robotics Club", $pageDescription, "https://robotics.ucf.edu/about/assets/imgs/contact/map.jpg");
$headerGen->endHeader();


// navbar
include_once("../assets/templates/navbar.php");
$navbarGen = new Navbar(False);


// page content
require_once('assets/templates/contact.html');
require_once('assets/templates/diamond-images.html');
require_once('assets/templates/side-nav-carousel.html');


// footer functions and include
// takes in an array customJs and lists all of it in the footer
function customJsStyles() {
  $customJs = array("assets/js/side-nav-carousel.js");
  echo "<!-- Additional js styles -->";
  foreach ($customJs as $currentJs) {
    echo "<script src=\"";
    echo $currentJs;
    echo "\"></script>";
  }
}
include_once("../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$customJs = array("assets/js/side-nav-carousel.js");
$footerGen->generateJs($customJs);
$footerGen->endFile();

?>
